const fs = require("fs/promises");
const path = require("path");

const TARGET = {
  label: "Meta - Av. Brig. Faria Lima, 3732 - Itaim Bibi",
  lat: -23.5889959,
  lng: -46.6821196
};

const CRITERIA = {
  minBedrooms: 2,
  maxRent: 9000,
  maxTotalCost: 9000,
  minArea: 50,
  maxDistanceKm: 4.5
};

const STREET_SEARCHES = [
  { street: "Rua Coronel Artur de Paula Ferreira", slug: "rua-coronel-artur-de-paula-ferreira-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Santa Justina", slug: "rua-santa-justina-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Bueno Brandão", slug: "rua-bueno-brandao-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Balthazar da Veiga", slug: "rua-balthazar-da-veiga-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Diogo Jácome", slug: "rua-diogo-jacome-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Afonso Braz", slug: "rua-afonso-braz-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Lourenço Castanho", slug: "rua-lourenco-castanho-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua João Lourenço", slug: "rua-joao-lourenco-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Inhambu", slug: "rua-inhambu-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Natividade", slug: "rua-natividade-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Monte Aprazível", slug: "rua-monte-aprazivel-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Marcos Lopes", slug: "rua-marcos-lopes-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Quatá", slug: "rua-quata-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Clodomiro Amazonas", slug: "rua-clodomiro-amazonas-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Professor Filadelfo Azevedo", slug: "rua-professor-filadelfo-azevedo-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Bastos Pereira", slug: "rua-bastos-pereira-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Avenida Santo Amaro", slug: "avenida-santo-amaro-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Avenida República do Líbano", slug: "avenida-republica-do-libano-vila-nova-conceicao-sao-paulo-sp-brasil" },
  { street: "Rua Groenlândia", slug: "rua-groenlandia-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Veneza", slug: "rua-veneza-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua General Mena Barreto", slug: "rua-general-mena-barreto-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Antonio Bento", slug: "rua-antonio-bento-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Maestro Chiaffarelli", slug: "rua-maestro-chiaffarelli-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Maestro Elias Lobo", slug: "rua-maestro-elias-lobo-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Avenida Brasil", slug: "avenida-brasil-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Gironda", slug: "rua-gironda-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Primavera", slug: "rua-primavera-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Ouro Branco", slug: "rua-ouro-branco-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Oliveira Dias", slug: "rua-oliveira-dias-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Alameda Joaquim Eugênio de Lima", slug: "alameda-joaquim-eugenio-de-lima-jardim-paulista-sao-paulo-sp-brasil" },
  { street: "Rua Estados Unidos", slug: "rua-estados-unidos-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Canadá", slug: "rua-canada-jardim-europa-sao-paulo-sp-brasil" },
  { street: "Rua Cuba", slug: "rua-cuba-jardim-europa-sao-paulo-sp-brasil" }
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache"
};

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

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

function hasYes(items, keys) {
  if (!Array.isArray(items)) return false;
  const wanted = new Set(keys);
  return items.some((item) => wanted.has(item.key) && item.value === "SIM");
}

function extractFeatures(home) {
  const amenities = home.amenities || [];
  const installations = home.installations || [];
  const comfort = home.comfortCommodities || [];
  const practicality = home.practicalityCommodities || [];
  const allHomeItems = [...amenities, ...comfort, ...practicality];

  return {
    balcony: hasYes(allHomeItems, ["VARANDA"]),
    gourmetBalcony: hasYes(allHomeItems, ["VARANDA_GOURMET"]),
    privatePool: hasYes(allHomeItems, ["PISCINA_PRIVATIVA"]),
    airConditioning: hasYes(allHomeItems, ["AR_CONDICIONADO"]),
    gasShower: hasYes(allHomeItems, ["CHUVEIRO_A_GAS"]),
    box: hasYes(allHomeItems, ["BOX"]),
    bedroomCabinets: hasYes(allHomeItems, ["ARMARIOS_EMBUTIDOS_NO_QUARTO"]),
    bathroomCabinets: hasYes(allHomeItems, ["ARMARIOS_NOS_BANHEIROS"]),
    kitchenCabinets: hasYes(allHomeItems, ["ARMARIOS_NA_COZINHA"]),
    pool: hasYes(installations, ["PISCINA"]),
    gym: hasYes(installations, ["ACADEMIA"]),
    partyRoom: hasYes(installations, ["SALAO_DE_FESTAS"]),
    gameRoom: hasYes(installations, ["SALAO_DE_JOGOS"]),
    grill: hasYes(installations, ["CHURRASQUEIRA"]),
    playground: hasYes(installations, ["PLAYGROUND"]),
    sauna: hasYes(installations, ["SAUNA"]),
    doorman24h: hasYes(installations, ["PORTARIA_24H"]),
    accessibleParking: hasYes(installations, ["VAGA_DE_GARAGEM_ACESSIVEL"])
  };
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

function matchingStreet(street) {
  const normalized = normalizeText(street);
  return STREET_SEARCHES.find((item) => normalized === normalizeText(item.street))?.street || "";
}

async function loadExistingIds() {
  try {
    const ranking = JSON.parse(await fs.readFile(path.join(__dirname, "ranking-com-candidatos.json"), "utf8"));
    return new Set((ranking.homes || []).map((home) => String(home.id)));
  } catch {
    return new Set();
  }
}

async function idsFromStreetPage(search) {
  const url = `https://www.quintoandar.com.br/alugar/imovel/${search.slug}/`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) return { ids: [], url, status: response.status };
  const html = await response.text();
  const ids = [...new Set([...html.matchAll(/\/imovel\/(\d{9})/g)].map((match) => match[1]))];
  return { ids, url: response.url || url, status: response.status };
}

async function scrapeProperty(id) {
  const url = `https://www.quintoandar.com.br/imovel/${id}/`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const html = await response.text();
  const data = extractNextData(html);
  if (!data) throw new Error(`sem __NEXT_DATA__: ${url}`);
  return extractHome(data, response.url || url, id);
}

function extractHome(data, fallbackUrl, fallbackId) {
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
  const lat = numberFrom(markers.lat || home.lat || address.lat);
  const lng = numberFrom(markers.lng || home.lng || address.lng);
  const targetDistanceKm = lat && lng ? distanceKm(TARGET, { lat, lng }) : 0;
  const street = pickFirst(address, ["street", "streetName"]) || "";
  const streetMatch = matchingStreet(street);
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
    street,
    url: pickFirst(home, ["canonicalUrl", "url"]) || fallbackUrl,
    rent: numberFrom(pickFirst(pricing, ["rent", "rentValue", "price"]) || pickFirst(home, ["rentPrice", "rent"])),
    condo: numberFrom(pickFirst(pricing, ["condo", "condominium", "condominiumFee"]) || pickFirst(home, ["condoPrice", "condo"])),
    iptu: numberFrom(pickFirst(pricing, ["iptu", "iptuFee"]) || pickFirst(home, ["iptu", "iptuPrice"])),
    area: numberFrom(pickFirst(home, ["area", "totalArea", "usableArea"])),
    bedrooms: numberFrom(pickFirst(home, ["bedrooms", "rooms"])),
    bathrooms: numberFrom(pickFirst(home, ["bathrooms"])),
    parking: numberFrom(pickFirst(home, ["parkingSpaces", "parking", "garageSpaces"])),
    acceptsPets: pickFirst(home, ["acceptsPets", "acceptPets", "petsAllowed", "allowsPets"]) ?? null,
    furnished: pickFirst(home, ["hasFurniture", "isFurnished", "furnished", "hasFurnitures"]) ?? null,
    features: extractFeatures(home),
    transit: 5,
    safety: 5,
    condition: 5,
    lightNoise: 5,
    targetDistanceKm: Number(targetDistanceKm.toFixed(2)),
    lat,
    lng,
    photos,
    notes: description,
    preferredStreet: Boolean(streetMatch),
    preferredStreetName: streetMatch
  };
}

function rejectionReason(home) {
  if (!home.preferredStreet) return "fora_das_ruas";
  if (home.street === "Avenida Santo Amaro" && home.neighborhood === "Brooklin") return "trecho_fora_das_capturas";
  if (home.rent === 0) return "sem_preco";
  if (home.bedrooms < CRITERIA.minBedrooms) return "quartos";
  if (home.rent > CRITERIA.maxRent) return "aluguel";
  if (home.rent + home.condo + home.iptu > CRITERIA.maxTotalCost) return "total";
  if (home.area > 0 && home.area < CRITERIA.minArea) return "area";
  if (home.targetDistanceKm > 0 && home.targetDistanceKm > CRITERIA.maxDistanceKm) return "distancia";
  return "";
}

async function main() {
  const existingIds = await loadExistingIds();
  const candidateIds = new Map();
  const streetResults = [];

  console.log(`Ruas na busca independente: ${STREET_SEARCHES.length}`);

  for (const search of STREET_SEARCHES) {
    const result = await idsFromStreetPage(search);
    const newIds = result.ids.filter((id) => !existingIds.has(id));
    for (const id of newIds) {
      if (!candidateIds.has(id)) candidateIds.set(id, { id, sourceStreet: search.street });
    }
    streetResults.push({ street: search.street, ids: result.ids.length, newIds: newIds.length, status: result.status });
    console.log(`${search.street}: ${result.ids.length} IDs (${newIds.length} novos)`);
    await sleep(250);
  }

  console.log(`\nIDs únicos novos vindos das páginas por rua: ${candidateIds.size}`);

  const homes = [];
  const rejected = [];
  const failed = [];
  let index = 0;

  for (const { id, sourceStreet } of candidateIds.values()) {
    index++;
    process.stdout.write(`[${index}/${candidateIds.size}] ${id} ... `);
    try {
      await sleep(350 + Math.random() * 350);
      const home = await scrapeProperty(id);
      const reason = rejectionReason(home);
      if (reason) {
        rejected.push({ id, sourceStreet, actualStreet: home.street, reason });
        process.stdout.write(`filtrado (${reason}; rua=${home.street || "-"})\n`);
        continue;
      }
      homes.push(home);
      process.stdout.write(`OK ${home.neighborhood} | ${home.street} | R$${home.rent + home.condo + home.iptu} | ${home.area}m² | ${home.bedrooms}q | ${home.targetDistanceKm}km\n`);
    } catch (error) {
      failed.push({ id, sourceStreet, reason: error.message });
      process.stdout.write(`erro (${error.message})\n`);
    }
  }

  const output = {
    scraped_at: new Date().toISOString(),
    mode: "street-only",
    criteria: CRITERIA,
    streets: STREET_SEARCHES.map((item) => item.street),
    street_results: streetResults,
    total_candidates_checked: candidateIds.size,
    total_passed: homes.length,
    total_rejected: rejected.length,
    total_failed: failed.length,
    homes,
    rejected,
    failed
  };

  await fs.writeFile(path.join(__dirname, "street-candidates.json"), JSON.stringify(output, null, 2));
  await fs.writeFile(path.join(__dirname, "new-candidates.json"), JSON.stringify({
    scraped_at: output.scraped_at,
    mode: output.mode,
    criteria: output.criteria,
    homes
  }, null, 2));

  console.log(`\n${homes.length} imóveis aprovados salvos em street-candidates.json e new-candidates.json`);
  if (homes.length) {
    console.table(homes.map((home) => ({
      id: home.id,
      bairro: home.neighborhood,
      rua: home.street,
      total: home.rent + home.condo + home.iptu,
      area: home.area,
      quartos: home.bedrooms,
      km: home.targetDistanceKm
    })));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
