const fs = require("fs/promises");
const path = require("path");

// ── Configuração ──────────────────────────────────────────────────────────────

const TARGET = {
  label: "Av. Brig. Faria Lima, 3732 - Itaim Bibi",
  lat: -23.5889959,
  lng: -46.6821196
};

// Critérios de filtragem
const CRITERIA = {
  minBedrooms: 2,
  maxRent: 15000,       // aluguel máximo R$
  maxTotalCost: 18000,  // aluguel + condomínio + iptu
  minArea: 50,          // m² mínimo
  maxDistanceKm: 3.0,   // distância máxima do target
  allowedNeighborhoods: ["itaim bibi", "vila olímpia", "vila olimpia"] // bairros aceitos
};

// Bairros alvo no QuintoAndar (slug da URL)
const SEARCH_CONFIGS = [
  { neighborhood: "Itaim Bibi",   slug: "itaim-bibi"   },
  { neighborhood: "Vila Olímpia", slug: "vila-olimpia"  },
];

// Cabeçalhos para evitar bloqueio básico
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1"
};

// ── Utilitários ───────────────────────────────────────────────────────────────

function numberFrom(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3})/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findObjects(value, predicate, output = []) {
  if (!value || typeof value !== "object") return output;
  if (predicate(value)) output.push(value);
  if (Array.isArray(value)) {
    value.forEach((item) => findObjects(item, predicate, output));
  } else {
    Object.values(value).forEach((item) => findObjects(item, predicate, output));
  }
  return output;
}

function pickFirst(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function distanceKm(a, b) {
  const earthKm = 6371;
  const toRad = (degree) => degree * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(h));
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Coletar IDs já conhecidos ─────────────────────────────────────────────────

const CACHE_FILE = path.join(__dirname, "checked-ids-cache.json");

async function loadKnownIds() {
  const knownIds = new Set();
  const files = [
    "scraped-data.json",
    "candidate-data.json",
    "researched-candidates.json",
    "ranking-com-candidatos.json"
  ];

  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(__dirname, file), "utf8");
      const data = JSON.parse(raw);
      const homes = data.homes || data.scraped || (Array.isArray(data) ? data : []);
      for (const home of homes) {
        if (home.id) knownIds.add(String(home.id));
        if (home.url) {
          const match = home.url.match(/\/imovel\/(\d+)\//);
          if (match) knownIds.add(match[1]);
        }
      }
    } catch {
      // arquivo não existe ou inválido, ignora
    }
  }

  // Carrega cache de IDs já verificados (passou ou foi rejeitado)
  try {
    const cacheRaw = await fs.readFile(CACHE_FILE, "utf8");
    const cache = JSON.parse(cacheRaw);
    for (const id of (cache.checked_ids || [])) knownIds.add(String(id));
    console.log(`📋 IDs já conhecidos: ${knownIds.size} (inclui ${cache.checked_ids?.length || 0} do cache)`);
  } catch {
    console.log(`📋 IDs já conhecidos: ${knownIds.size}`);
  }

  return knownIds;
}

async function saveCache(checkedIds) {
  let existing = [];
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    existing = JSON.parse(raw).checked_ids || [];
  } catch { /* novo arquivo */ }
  const merged = [...new Set([...existing, ...checkedIds])];
  await fs.writeFile(CACHE_FILE, JSON.stringify({ checked_ids: merged, updated_at: new Date().toISOString() }, null, 2));
  console.log(`💾 Cache atualizado: ${merged.length} IDs registrados`);
}

// Viewport cobrindo Itaim Bibi + Vila Olímpia com margem
// (Lat sul é menor numericamente que lat norte em coordenadas negativas no hemisfério sul)
const VIEWPORTS = [
  {
    // Itaim Bibi (core + norte)
    label: "Itaim Bibi norte",
    north: -23.565, south: -23.600, east: -46.650, west: -46.700
  },
  {
    // Itaim Bibi (sul) + Vila Olímpia
    label: "Itaim Bibi sul / Vila Olímpia",
    north: -23.595, south: -23.635, east: -46.655, west: -46.715
  }
];

// ── Busca via API de coordenadas do QuintoAndar (apigw.prod) ──────────────────

async function searchViaCoordinatesApi(viewport, currentPage = 0) {
  const params = new URLSearchParams({
    "fields[0]": "id",
    "fields[1]": "location",
    "fields[2]": "rentPrice",
    "fields[3]": "area",
    "fields[4]": "bedrooms",
    "context.deviceId": "copilot-search-agent",
    "context.listShowing": "true",
    "context.numPhotos": "0",
    "context.isSSR": "false",
    "filters.businessContext": "RENT",
    "filters.location.viewport.north": String(viewport.north),
    "filters.location.viewport.south": String(viewport.south),
    "filters.location.viewport.east": String(viewport.east),
    "filters.location.viewport.west": String(viewport.west),
    "filters.location.countryCode": "BR",
    "filters.availability": "ANY",
    "filters.occupancy": "ANY",
    "filters.enableFlexibleSearch": "false",
    "pagination.pageSize": "30",
    "pagination.currentPage": String(currentPage)
  });

  const url = `https://apigw.prod.quintoandar.com.br/house-listing-search/v2/search/coordinates?${params}`;
  const response = await fetch(url, {
    headers: {
      ...HEADERS,
      "Accept": "application/json",
      "Origin": "https://www.quintoandar.com.br",
      "Referer": "https://www.quintoandar.com.br/"
    }
  });

  if (!response.ok) return null;

  try {
    return await response.json();
  } catch {
    return null;
  }
}

// ── Busca via página de listagem (fallback) ───────────────────────────────────

async function searchViaPage(slug) {
  const urls = [
    `https://quintoandar.com.br/alugar/imovel/sao-paulo/${slug}/2-quartos/`,
    `https://quintoandar.com.br/alugar/imovel/sao-paulo/${slug}/`,
    `https://quintoandar.com.br/casas-para-alugar/cidade/sao-paulo/bairro/${slug}/`
  ];

  for (const pageUrl of urls) {
    try {
      console.log(`  Tentando: ${pageUrl}`);
      const response = await fetch(pageUrl, { headers: HEADERS });
      if (!response.ok) continue;
      const html = await response.text();
      const data = extractNextData(html);
      if (!data) continue;

      // Procura por listagens no __NEXT_DATA__
      const listings = [];
      findObjects(data, (item) => {
        if (item.id && (item.rentPrice !== undefined || item.rent !== undefined) && item.address) {
          listings.push(item);
          return true;
        }
        return false;
      });

      // Também tenta extrair IDs de propriedades da página
      const idMatches = html.matchAll(/\/imovel\/(\d{9,})\//g);
      const pageIds = [...new Set([...idMatches].map((m) => m[1]))];

      if (listings.length > 0 || pageIds.length > 0) {
        console.log(`  ✓ Encontrados ${listings.length} listagens + ${pageIds.length} IDs na página`);
        return { listings, pageIds, data };
      }
    } catch (err) {
      console.log(`  ✗ Erro: ${err.message}`);
    }
  }
  return { listings: [], pageIds: [], data: null };
}

// ── Scrape de imóvel individual ───────────────────────────────────────────────

async function scrapeProperty(id) {
  const url = `https://quintoandar.com.br/imovel/${id}/`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const html = await response.text();

  // Tenta __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData) {
    return extractFromNextData(nextData, response.url || url, id);
  }

  // Fallback: tenta extrair dados direto do HTML com regex
  return extractFromHtml(html, url, id);
}

function extractFromNextData(data, fallbackUrl, fallbackId) {
  const house = data?.props?.pageProps?.initialState?.house || {};
  const candidates = findObjects(data, (item) => {
    return item.id && item.rentPrice !== undefined && item.area !== undefined && item.address;
  });
  const home = house.houseInfo || candidates[0] || {};
  const markers = house.markers || {};
  const pricing = Array.isArray(home.pricingInfos) ? home.pricingInfos[0] : home.pricingInfos || {};
  const title = data?.props?.pageProps?.seoData?.title
    || pickFirst(home, ["title", "shortDescription"])
    || "";
  const description = home.generatedDescription?.shortRentDescription || home.generatedDescription?.longDescription || "";
  const address = home.address || {};
  const lat = numberFrom(markers.lat || home.lat);
  const lng = numberFrom(markers.lng || home.lng);
  const targetDistKm = lat && lng ? distanceKm(TARGET, { lat, lng }) : 0;
  const photos = Array.isArray(home.photos)
    ? home.photos.slice(0, 12).map((photo) => ({
      url: photo.url?.startsWith("http") ? photo.url : `https://www.quintoandar.com.br/img/med/${photo.url}`,
      subtitle: photo.subtitle || "",
      cover: Boolean(photo.cover)
    }))
    : [];

  return {
    id: String(pickFirst(home, ["id", "houseId"]) || data?.query?.houseId || fallbackId),
    title: title.replace(" - QuintoAndar", "").trim() || `QuintoAndar ${fallbackId}`,
    neighborhood: pickFirst(address, ["neighborhood", "regionName", "cityNeighborhood"]) || "",
    street: pickFirst(address, ["street", "streetName"]) || "",
    url: pickFirst(home, ["canonicalUrl", "url"]) || fallbackUrl,
    rent: numberFrom(pickFirst(pricing, ["rent", "rentValue", "price"]) || pickFirst(home, ["rentPrice", "rent"])),
    condo: numberFrom(pickFirst(pricing, ["condo", "condominium", "condominiumFee"]) || pickFirst(home, ["condoPrice", "condo"])),
    iptu: numberFrom(pickFirst(pricing, ["iptu", "iptuFee"]) || pickFirst(home, ["iptu", "iptuPrice"])),
    area: numberFrom(pickFirst(home, ["area", "totalArea", "usableArea"])),
    bedrooms: numberFrom(pickFirst(home, ["bedrooms", "rooms"])),
    bathrooms: numberFrom(pickFirst(home, ["bathrooms"])),
    parking: numberFrom(pickFirst(home, ["parkingSpaces", "parking", "garageSpaces"])),
    transit: 5,
    safety: 5,
    condition: 5,
    lightNoise: 5,
    targetDistanceKm: Number(targetDistKm.toFixed(2)),
    lat,
    lng,
    photos,
    notes: description
  };
}

function extractFromHtml(html, url, id) {
  // Extração básica via regex como último recurso
  const rentMatch = html.match(/(?:aluguel|rent)[^\d]*R\$\s*([\d.]+,\d{2})/i);
  const areaMatch = html.match(/(\d+)\s*m[²2]/);
  const bedsMatch = html.match(/(\d+)\s*(?:quartos?|dorms?)/i);

  return {
    id: String(id),
    title: `QuintoAndar ${id}`,
    neighborhood: "",
    street: "",
    url,
    rent: rentMatch ? numberFrom(rentMatch[1]) : 0,
    condo: 0,
    iptu: 0,
    area: areaMatch ? Number(areaMatch[1]) : 0,
    bedrooms: bedsMatch ? Number(bedsMatch[1]) : 0,
    bathrooms: 0,
    parking: 0,
    transit: 5,
    safety: 5,
    condition: 5,
    lightNoise: 5,
    targetDistanceKm: 0,
    lat: 0,
    lng: 0,
    photos: [],
    notes: ""
  };
}

// ── Filtro de critérios ───────────────────────────────────────────────────────

function meetssCriteria(home) {
  if (home.rent === 0) return false; // não conseguiu extrair dados
  if (home.bedrooms < CRITERIA.minBedrooms) return false;
  if (home.rent > CRITERIA.maxRent) return false;
  const totalCost = home.rent + home.condo + home.iptu;
  if (totalCost > CRITERIA.maxTotalCost) return false;
  if (home.area > 0 && home.area < CRITERIA.minArea) return false;
  if (home.targetDistanceKm > 0 && home.targetDistanceKm > CRITERIA.maxDistanceKm) return false;
  // Bairro obrigatório
  const nb = (home.neighborhood || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const allowed = CRITERIA.allowedNeighborhoods.map(n => n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  if (home.neighborhood && !allowed.some(a => nb.includes(a))) return false;
  return true;
}

// ── Pipeline principal ────────────────────────────────────────────────────────

async function main() {
  const knownIds = await loadKnownIds();
  const candidateIds = new Set();

  // 1. API de coordenadas geográficas (apigw.prod.quintoandar.com.br)
  const MAX_CANDIDATES = 80; // por run
  const MAX_PAGES = 5;       // páginas da API por viewport
  console.log("\n🔍 Buscando via API de coordenadas do QuintoAndar...");
  for (const viewport of VIEWPORTS) {
    if (candidateIds.size >= MAX_CANDIDATES) break;
    console.log(`\n  Área: ${viewport.label}`);
    for (let page = 0; page < MAX_PAGES; page++) {
      if (candidateIds.size >= MAX_CANDIDATES) break;
      try {
        const result = await searchViaCoordinatesApi(viewport, page);
        if (!result) {
          console.log(`  ✗ API não respondeu (página ${page})`);
          break;
        }
        const hits = result.hits?.hits || [];
        if (hits.length === 0) {
          console.log(`  → Sem mais resultados na página ${page}`);
          break;
        }
        let novos = 0;
        for (const hit of hits) {
          if (candidateIds.size >= MAX_CANDIDATES) break;
          const id = String(hit._id || hit._source?.id || "");
          if (!id || knownIds.has(id)) continue;
          // Pré-filtro com dados que já vêm da API
          const src = hit._source || {};
          const rent = numberFrom(src.rentPrice);
          const area = numberFrom(src.area);
          const beds = numberFrom(src.bedrooms);
          if (rent > 0 && rent > CRITERIA.maxRent) continue;
          if (area > 0 && area < CRITERIA.minArea) continue;
          if (beds > 0 && beds < CRITERIA.minBedrooms) continue;
          candidateIds.add(id);
          novos++;
        }
        console.log(`  ✓ Página ${page}: ${hits.length} imóveis → ${novos} novos pré-selecionados (total: ${candidateIds.size})`);
        if (hits.length < 30) break; // menos de uma página cheia = acabou
        await sleep(400);
      } catch (err) {
        console.log(`  ✗ Erro: ${err.message}`);
        break;
      }
    }
  }

  // 2. Fallback via página de listagem se API falhou
  if (candidateIds.size === 0) {
    console.log("\n🔍 Fallback: buscando via páginas de listagem...");
    for (const { neighborhood, slug } of SEARCH_CONFIGS) {
      console.log(`\n  Bairro: ${neighborhood} (slug: ${slug})`);
      const { listings, pageIds } = await searchViaPage(slug);
      for (const item of listings) {
        const id = String(item.id || "");
        if (id && !knownIds.has(id)) candidateIds.add(id);
      }
      for (const id of pageIds) {
        if (!knownIds.has(id)) candidateIds.add(id);
      }
      await sleep(1200);
    }
  }

  console.log(`\n📦 IDs candidatos novos encontrados: ${candidateIds.size}`);

  if (candidateIds.size === 0) {
    console.log("⚠️  Nenhum ID novo encontrado. Verifique a conexão ou tente manualmente.");
    process.exit(0);
  }

  // 3. Scraping individual de cada candidato
  console.log("\n🏠 Fazendo scraping de cada candidato...\n");
  const scrapedHomes = [];
  const failed = [];
  let idx = 0;

  const checkedIds = []; // todos os IDs verificados neste run (para o cache)

  for (const id of candidateIds) {
    idx++;
    process.stdout.write(`  [${idx}/${candidateIds.size}] ${id} ... `);
    try {
      await sleep(600 + Math.random() * 600);
      const home = await scrapeProperty(id);
      checkedIds.push(id);

      if (home.rent === 0) {
        // CSR: QuintoAndar não fez SSR desta página — dados indisponíveis sem browser
        process.stdout.write(`⚠ CSR (sem dados no HTML — marcado no cache)\n`);
        continue;
      }

      const passes = meetssCriteria(home);
      process.stdout.write(
        passes
          ? `✓ ${home.neighborhood} | R$${home.rent.toLocaleString("pt-BR")} | ${home.area}m² | ${home.bedrooms}q | ${home.targetDistanceKm}km\n`
          : `⊘ filtrado (rent=${home.rent}, area=${home.area}, beds=${home.bedrooms}, dist=${home.targetDistanceKm}km)\n`
      );
      if (passes) scrapedHomes.push(home);
    } catch (err) {
      process.stdout.write(`✗ Erro: ${err.message}\n`);
      failed.push(id);
      checkedIds.push(id); // mesmo falhas entram no cache para não repetir
    }
  }

  // Salvar cache de IDs verificados
  await saveCache(checkedIds);

  // 4. Salvar resultados
  const output = {
    scraped_at: new Date().toISOString(),
    criteria: CRITERIA,
    total_candidates_checked: candidateIds.size,
    total_passed: scrapedHomes.length,
    total_failed: failed.length,
    homes: scrapedHomes,
    failed_ids: failed
  };

  const outFile = path.join(__dirname, "new-candidates.json");
  await fs.writeFile(outFile, JSON.stringify(output, null, 2));

  console.log(`\n✅ ${scrapedHomes.length} imóveis novos salvos em new-candidates.json`);
  if (failed.length > 0) {
    console.log(`⚠️  ${failed.length} imóveis não puderam ser carregados: ${failed.join(", ")}`);
  }

  if (scrapedHomes.length > 0) {
    console.log("\n📊 Resumo dos novos candidatos:");
    console.table(scrapedHomes.map((h) => ({
      id: h.id,
      bairro: h.neighborhood,
      aluguel: h.rent,
      condo: h.condo,
      iptu: h.iptu,
      total: h.rent + h.condo + h.iptu,
      area: h.area,
      quartos: h.bedrooms,
      km: h.targetDistanceKm
    })));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
