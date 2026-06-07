#!/usr/bin/env node
/**
 * Automação local de visitas confirmadas via Google Workspace CLI (`gws`).
 *
 * Fluxo:
 * - Busca no Gmail e-mails "Eba, sua visita foi confirmada!".
 * - Extrai imóvel/data/endereço do e-mail.
 * - Marca `visit.status = "confirmed"` no ranking e no seedHomes.
 * - Cria evento no Google Calendar via `gws`.
 * - Opcionalmente commita e faz push das mudanças para o GitHub.
 *
 * Requer `gws` autenticado nesta máquina.
 */

const fs = require("fs/promises");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const RANKING_FILE = path.join(ROOT, "ranking-com-candidatos.json");
const INDEX_FILE = path.join(ROOT, "index.html");

const GMAIL_QUERY = 'from:nao-responda@quintoandar.com.br subject:"Eba, sua visita foi confirmada!" newer_than:180d -in:trash -in:spam';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const EVENT_DURATION_MINUTES = Number(process.env.VISIT_EVENT_DURATION_MINUTES || 45);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const shouldPush = args.has("--push");

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

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeout || 120000,
    stdio: options.stdio || ["ignore", "pipe", "pipe"]
  }).trim();
}

function runJson(command, commandArgs) {
  const output = run(command, commandArgs);
  return output ? JSON.parse(output) : {};
}

function runGws(commandArgs) {
  return runJson("gws", [...commandArgs, "--format", "json"]);
}

function decodeBase64Url(value) {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|tr|p|div|table|h[1-6])>/gi, "\n")
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

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

function getHeader(payload, name) {
  const headers = payload?.headers || [];
  const found = headers.find((header) => String(header.name).toLowerCase() === name.toLowerCase());
  return found?.value || "";
}

function collectBody(payload, output = []) {
  if (!payload) return output;
  if (payload.body?.data && /^text\/(plain|html)$/i.test(payload.mimeType || "")) {
    const decoded = decodeBase64Url(payload.body.data);
    output.push(decoded);
    if (payload.mimeType === "text/html") output.push(stripHtml(decoded));
  }
  for (const part of payload.parts || []) collectBody(part, output);
  return output;
}

function messageText(message) {
  return collectBody(message.payload)
    .concat(message.snippet || "")
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHomeId(text) {
  const patterns = [
    /\/imovel\/(\d{9})/i,
    /houseId=(\d{9})/i,
    /\bcapa(\d{9})/i,
    /\boriginal(\d{9})/i,
    /\b(\d{9})[-_]/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function extractAddress(text) {
  const cleanText = stripHtml(text);
  const match = cleanText.match(/Endere[cç]o\s+(.+?)\s+Corretor\b/i);
  return match?.[1]?.trim() || "";
}

function resolveYear(day, month, emailDate) {
  const base = emailDate ? new Date(emailDate) : new Date();
  let year = base.getFullYear();
  let candidate = new Date(year, month, day);
  if (candidate.getTime() < base.getTime() - 1000 * 60 * 60 * 24 * 45) {
    year += 1;
  }
  return year;
}

function extractVisitDateTime(text, emailDate) {
  const compact = text.replace(/\s+/g, " ");
  const monthNames = Object.keys(MONTHS).join("|");
  const patterns = [
    new RegExp(`(?:Dia e hor[aá]rio\\s*)?(?:[A-Za-zçÇ-]+,\\s*)?(\\d{1,2})\\s+de\\s+(${monthNames})\\s+(?:de\\s+)?(\\d{4})?\\s*(?:às|as)\\s*(\\d{1,2})[:h](\\d{2})`, "i"),
    /\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\s*(?:às|as)?\s*(\d{1,2})[:h](\d{2})/i
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match) continue;
    const day = Number(match[1]);
    const month = Number.isNaN(Number(match[2])) ? MONTHS[normalizeText(match[2])] : Number(match[2]) - 1;
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : resolveYear(day, month, emailDate);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const date = new Date(year, month, day, hour, minute, 0);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function listConfirmedVisitMessages() {
  const result = runGws([
    "gmail", "users", "messages", "list",
    "--params", JSON.stringify({ userId: "me", q: GMAIL_QUERY, maxResults: 100 })
  ]);
  return result.messages || [];
}

function getMessage(id) {
  return runGws([
    "gmail", "users", "messages", "get",
    "--params", JSON.stringify({ userId: "me", id, format: "full" })
  ]);
}

function findExistingCalendarEvent(homeId) {
  const result = runGws([
    "calendar", "events", "list",
    "--params", JSON.stringify({
      calendarId: CALENDAR_ID,
      privateExtendedProperty: `quintoAndarHomeId=${homeId}`,
      singleEvents: true,
      maxResults: 10
    })
  ]);
  return (result.items || []).find((event) => event.status !== "cancelled") || null;
}

function eventPayload(home, start, message, address) {
  const end = new Date(start.getTime() + EVENT_DURATION_MINUTES * 60_000);
  const total = (home.rent || 0) + (home.condo || 0) + (home.iptu || 0);
  return {
    summary: `Visita QuintoAndar - ${home.neighborhood || home.title || home.id}`,
    location: address || [home.street, home.neighborhood, "São Paulo"].filter(Boolean).join(", "),
    description: [
      `Imóvel QuintoAndar: ${home.id}`,
      home.url ? `Anúncio: ${home.url}` : "",
      `Bairro: ${home.neighborhood || ""}`,
      `Endereço: ${address || [home.street, home.neighborhood].filter(Boolean).join(" - ")}`,
      `Total estimado: R$ ${total.toLocaleString("pt-BR")}`,
      `Email Gmail: ${message.id}`
    ].filter(Boolean).join("\n"),
    start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
    end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 60 },
        { method: "popup", minutes: 15 }
      ]
    },
    extendedProperties: {
      private: {
        quintoAndarHomeId: String(home.id),
        source: "imoveis-sp-ranking"
      }
    }
  };
}

function createCalendarEvent(home, start, message, address) {
  const existing = findExistingCalendarEvent(String(home.id));
  if (existing) return existing;

  const payload = eventPayload(home, start, message, address);
  if (dryRun) return { id: "dry-run", htmlLink: "", ...payload };

  return runGws([
    "calendar", "events", "insert",
    "--params", JSON.stringify({ calendarId: CALENDAR_ID, sendUpdates: "none" }),
    "--json", JSON.stringify(payload)
  ]);
}

async function updateSeedHomes(homes) {
  let html = await fs.readFile(INDEX_FILE, "utf8");
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
  await fs.writeFile(INDEX_FILE, html);
}

function gitHasChanges() {
  return Boolean(run("git", ["status", "--short"]));
}

function commitAndPush(processedCount) {
  if (!shouldPush || dryRun || !gitHasChanges()) return false;
  run("git", ["add", "ranking-com-candidatos.json", "index.html"], { stdio: "inherit" });
  run("git", ["commit", "-m", `Sync confirmed QuintoAndar visits (${processedCount})`], { stdio: "inherit" });
  run("git", ["push"], { stdio: "inherit", timeout: 120000 });
  return true;
}

async function main() {
  const ranking = await readJson(RANKING_FILE);
  const homes = ranking.homes || [];
  const homesById = new Map(homes.map((home) => [String(home.id), home]));

  const messageRefs = listConfirmedVisitMessages();
  console.log(`Emails de visita confirmada encontrados: ${messageRefs.length}`);

  const processed = [];
  const skipped = [];
  let changed = false;

  for (const ref of messageRefs) {
    const message = getMessage(ref.id);
    const subject = getHeader(message.payload, "Subject");
    const from = getHeader(message.payload, "From");
    const emailDate = getHeader(message.payload, "Date");
    const text = messageText(message);
    const homeId = extractHomeId(text);
    const home = homesById.get(String(homeId));
    const scheduledAt = extractVisitDateTime(text, emailDate);
    const address = extractAddress(text);

    if (!homeId || !home || !scheduledAt) {
      skipped.push({
        messageId: message.id,
        subject,
        from,
        homeId,
        address,
        reason: !homeId ? "sem_id" : !home ? "fora_do_ranking" : "sem_data"
      });
      continue;
    }

    const event = createCalendarEvent(home, scheduledAt, message, address);
    const nextVisit = {
      status: "confirmed",
      source: "gmail-gws",
      emailMessageId: message.id,
      emailSubject: subject,
      confirmedAt: emailDate ? new Date(emailDate).toISOString() : new Date().toISOString(),
      scheduledAt: scheduledAt.toISOString(),
      address,
      calendarEventId: event.id,
      calendarHtmlLink: event.htmlLink || home.visit?.calendarHtmlLink || ""
    };

    if (JSON.stringify(home.visit || null) !== JSON.stringify(nextVisit)) {
      home.visit = nextVisit;
      changed = true;
    }

    processed.push({
      id: home.id,
      title: home.title,
      scheduledAt: home.visit.scheduledAt,
      address,
      calendarEventId: home.visit.calendarEventId
    });
  }

  if (!dryRun && changed) {
    ranking.updated_at = new Date().toISOString();
    await writeJson(RANKING_FILE, ranking);
    await updateSeedHomes(homes);
  }

  const pushed = commitAndPush(processed.length);
  console.log(JSON.stringify({ dryRun, changed, pushed, processed, skipped }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
