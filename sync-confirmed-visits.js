#!/usr/bin/env node
/**
 * Sincroniza visitas confirmadas do QuintoAndar:
 * 1. Busca no Gmail e-mails "Eba, sua visita foi confirmada!".
 * 2. Extrai o ID do imóvel e a data/horário da visita.
 * 3. Marca o imóvel no ranking como visita confirmada.
 * 4. Cria um evento no Google Calendar se ainda não existir.
 *
 * Requer OAuth local do Google. Veja LOCAL_AUTOMATION.md.
 */

const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = __dirname;
const CLIENT_FILE = path.join(ROOT, ".google-oauth-client.json");
const TOKEN_FILE = path.join(ROOT, ".google-token.json");
const RANKING_FILE = path.join(ROOT, "ranking-com-candidatos.json");
const INDEX_FILE = path.join(ROOT, "index.html");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events"
];

const GMAIL_QUERY = 'from:nao-responda@quintoandar.com.br subject:"Eba, sua visita foi confirmada!" newer_than:180d -in:trash -in:spam';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const EVENT_DURATION_MINUTES = Number(process.env.VISIT_EVENT_DURATION_MINUTES || 45);

const MONTHS = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  março: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function loadOAuthClient() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET
    };
  }

  let raw;
  try {
    raw = await readJson(CLIENT_FILE);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Credenciais OAuth não encontradas. Crie .google-oauth-client.json ou defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET. Veja LOCAL_AUTOMATION.md.");
    }
    throw error;
  }
  const config = raw.installed || raw.web || raw;
  if (!config.client_id || !config.client_secret) {
    throw new Error("Credenciais OAuth inválidas. Informe GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ou .google-oauth-client.json.");
  }
  return config;
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, commandArgs, () => {});
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const message = json.error_description || json.error?.message || json.error || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return json;
}

async function refreshToken(client, token) {
  if (!token.refresh_token) return null;
  const body = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token"
  });
  const refreshed = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return {
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    expires_at: Date.now() + refreshed.expires_in * 1000
  };
}

async function authorize() {
  const client = await loadOAuthClient();
  let token = await readJson(TOKEN_FILE, {});

  if (token.access_token && token.expires_at && token.expires_at - Date.now() > 60_000) {
    return token.access_token;
  }

  if (token.refresh_token) {
    token = await refreshToken(client, token);
    if (token?.access_token) {
      await writeJson(TOKEN_FILE, token);
      return token.access_token;
    }
  }

  const port = Number(process.env.GOOGLE_OAUTH_PORT || 53682);
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url, redirectUri);
      if (requestUrl.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      if (requestUrl.searchParams.get("state") !== state) {
        res.writeHead(400);
        res.end("Estado OAuth inválido.");
        server.close();
        reject(new Error("Estado OAuth inválido."));
        return;
      }
      const authCode = requestUrl.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Autorização concluída. Você pode fechar esta janela.");
      server.close();
      resolve(authCode);
    });

    server.listen(port, "127.0.0.1", () => {
      console.log("Abra a URL para autorizar Gmail + Calendar:");
      console.log(authUrl.toString());
      openBrowser(authUrl.toString());
    });
    server.on("error", reject);
  });

  const body = new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  token.expires_at = Date.now() + token.expires_in * 1000;
  await writeJson(TOKEN_FILE, token);
  return token.access_token;
}

async function googleApi(accessToken, url, options = {}) {
  return requestJson(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function listConfirmedVisitMessages(accessToken) {
  const messages = [];
  let pageToken = "";
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", GMAIL_QUERY);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await googleApi(accessToken, url);
    messages.push(...(result.messages || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return messages;
}

async function getMessage(accessToken, id) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`;
  return googleApi(accessToken, url);
}

function header(message, name) {
  const found = message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return found?.value || "";
}

function collectBody(payload, output = []) {
  if (!payload) return output;
  if (payload.body?.data && /^text\/(plain|html)$/i.test(payload.mimeType || "")) {
    output.push({
      mimeType: payload.mimeType,
      text: base64UrlDecode(payload.body.data)
    });
  }
  for (const part of payload.parts || []) collectBody(part, output);
  return output;
}

function messageText(message) {
  const bodies = collectBody(message.payload);
  const plain = bodies.filter((part) => part.mimeType === "text/plain").map((part) => part.text).join("\n");
  const html = bodies.filter((part) => part.mimeType === "text/html").map((part) => stripHtml(part.text)).join("\n");
  return [plain, html, message.snippet || ""].filter(Boolean).join("\n");
}

function extractHomeId(text) {
  const patterns = [
    /\/imovel\/(\d{6,})/i,
    /houseId=(\d{6,})/i,
    /\bim[oó]vel\s+(\d{6,})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function extractTime(text) {
  const match = text.match(/\b(?:às|as|hor[aá]rio[:\s]*)\s*(\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|horas)?\b/i)
    || text.match(/\b(\d{1,2})[:h](\d{2})\s*(?:h|hs|horas)?\b/i)
    || text.match(/\b(\d{1,2})h\b/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function resolveYear(day, month, emailDate) {
  const base = emailDate ? new Date(emailDate) : new Date();
  let year = base.getFullYear();
  let candidate = new Date(year, month, day);
  if (candidate.getTime() < base.getTime() - 1000 * 60 * 60 * 24 * 45) {
    candidate = new Date(year + 1, month, day);
    year += 1;
  }
  return year;
}

function extractVisitDateTime(text, emailDate) {
  const normalized = text.replace(/\s+/g, " ");
  const candidates = [];

  for (const match of normalized.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : resolveYear(day, month, emailDate);
    const windowText = normalized.slice(match.index, match.index + 160);
    candidates.push({ day, month, year, time: extractTime(windowText), index: match.index });
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const monthRegex = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${monthNames})(?:\\s+de\\s+(\\d{4}))?\\b`, "gi");
  for (const match of normalized.matchAll(monthRegex)) {
    const day = Number(match[1]);
    const month = MONTHS[normalizeText(match[2])];
    const year = match[3] ? Number(match[3]) : resolveYear(day, month, emailDate);
    const windowText = normalized.slice(match.index, match.index + 180);
    candidates.push({ day, month, year, time: extractTime(windowText), index: match.index });
  }

  const best = candidates.find((candidate) => candidate.time) || candidates[0];
  if (!best || best.month < 0 || best.month > 11 || best.day < 1 || best.day > 31) return null;
  const start = new Date(best.year, best.month, best.day, best.time?.hour || 9, best.time?.minute || 0, 0);
  if (Number.isNaN(start.getTime())) return null;
  return start;
}

function eventTimes(start) {
  const end = new Date(start.getTime() + EVENT_DURATION_MINUTES * 60_000);
  return {
    start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
    end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" }
  };
}

function calendarDescription(home, message) {
  return [
    `Imóvel QuintoAndar: ${home.id}`,
    home.url ? `Anúncio: ${home.url}` : "",
    `Bairro: ${home.neighborhood || ""}`,
    `Endereço: ${[home.street, home.neighborhood].filter(Boolean).join(" - ")}`,
    `Total estimado: R$ ${((home.rent || 0) + (home.condo || 0) + (home.iptu || 0)).toLocaleString("pt-BR")}`,
    `Email Gmail: ${message.id}`
  ].filter(Boolean).join("\n");
}

async function findExistingCalendarEvent(accessToken, homeId) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
  url.searchParams.append("privateExtendedProperty", `quintoAndarHomeId=${homeId}`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("maxResults", "10");
  const result = await googleApi(accessToken, url);
  return (result.items || []).find((event) => event.status !== "cancelled") || null;
}

async function createCalendarEvent(accessToken, home, start, message) {
  const existing = await findExistingCalendarEvent(accessToken, String(home.id));
  if (existing) return existing;

  const times = eventTimes(start);
  const event = {
    summary: `Visita QuintoAndar - ${home.neighborhood || home.title || home.id}`,
    location: [home.street, home.neighborhood, "São Paulo"].filter(Boolean).join(", "),
    description: calendarDescription(home, message),
    ...times,
    extendedProperties: {
      private: {
        quintoAndarHomeId: String(home.id),
        source: "imoveis-sp-ranking"
      }
    }
  };

  if (dryRun) return { id: "dry-run", htmlLink: "", ...event };

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
  return googleApi(accessToken, url, {
    method: "POST",
    body: JSON.stringify(event)
  });
}

async function updateSeedHomes(homes) {
  const htmlPath = INDEX_FILE;
  let html = await fs.readFile(htmlPath, "utf8");
  const openMarker = "    const seedHomes = [";
  const closeMarker = "\n    ];";
  const startIdx = html.indexOf(openMarker);
  const endIdx = html.indexOf(closeMarker, startIdx + openMarker.length);
  if (startIdx === -1 || endIdx === -1) throw new Error("Bloco seedHomes não encontrado no index.html");
  const homesJson = JSON.stringify(homes, null, 6)
    .split("\n")
    .map((line, index) => (index === 0 ? line : "    " + line))
    .join("\n");
  html = html.slice(0, startIdx) + `    const seedHomes = ${homesJson};` + html.slice(endIdx + closeMarker.length);
  await fs.writeFile(htmlPath, html);
}

async function main() {
  const accessToken = await authorize();
  const ranking = await readJson(RANKING_FILE);
  const homes = ranking.homes || [];
  const homesById = new Map(homes.map((home) => [String(home.id), home]));

  const messageRefs = await listConfirmedVisitMessages(accessToken);
  console.log(`Emails de visita confirmada encontrados: ${messageRefs.length}`);

  const processed = [];
  const skipped = [];
  let changed = false;

  for (const ref of messageRefs) {
    const message = await getMessage(accessToken, ref.id);
    const subject = header(message, "Subject");
    const from = header(message, "From");
    const emailDate = header(message, "Date");
    const text = messageText(message);
    const homeId = extractHomeId(text);
    const home = homesById.get(String(homeId));
    const start = extractVisitDateTime(text, emailDate);

    if (!homeId || !home || !start) {
      skipped.push({ messageId: message.id, subject, from, homeId, reason: !homeId ? "sem_id" : !home ? "fora_do_ranking" : "sem_data" });
      continue;
    }

    const event = await createCalendarEvent(accessToken, home, start, message);
    const nextVisit = {
      status: "confirmed",
      source: "gmail",
      emailMessageId: message.id,
      emailSubject: subject,
      confirmedAt: emailDate ? new Date(emailDate).toISOString() : new Date().toISOString(),
      scheduledAt: start.toISOString(),
      calendarEventId: event.id,
      calendarHtmlLink: event.htmlLink || home.visit?.calendarHtmlLink || ""
    };
    if (JSON.stringify(home.visit || null) !== JSON.stringify(nextVisit)) {
      home.visit = nextVisit;
      changed = true;
    }
    processed.push({ id: home.id, title: home.title, scheduledAt: home.visit.scheduledAt, calendarEventId: home.visit.calendarEventId });
  }

  if (!dryRun && changed) {
    ranking.updated_at = new Date().toISOString();
    await writeJson(RANKING_FILE, ranking);
    await updateSeedHomes(homes);
  }

  console.log(JSON.stringify({ dryRun, changed, processed, skipped }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
