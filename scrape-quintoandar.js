const fs = require("fs/promises");
const path = require("path");

const TARGET = {
  label: "Meta - Av. Paulista, 91 - Bela Vista",
  lat: -23.561817,
  lng: -46.6559323
};

const URLS = [
  "https://quintoandar.com.br/imovel/893893736/?utm_campaign=rental&utm_source=shared&utm_medium=copy_share",
  "https://quintoandar.com.br/imovel/892829983/?utm_campaign=rental&utm_source=shared&utm_medium=copy_share",
  "https://quintoandar.com.br/imovel/895411473/?utm_campaign=rental&utm_source=shared&utm_medium=copy_share",
  "https://quintoandar.com.br/imovel/894458391/?utm_campaign=rental&utm_source=shared&utm_medium=copy_share",
  "https://quintoandar.com.br/imovel/895379553/?utm_campaign=rental&utm_source=shared&utm_medium=copy_share",
  "https://quintoandar.com.br/imovel/893343044/?utm_campaign=rental&utm_source=shared&utm_medium=copy_share"
];

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
  if (!match) throw new Error("Nao encontrei __NEXT_DATA__ na pagina");
  return JSON.parse(match[1]);
}

function extractHome(data, fallbackUrl) {
  const house = data?.props?.pageProps?.initialState?.house || {};
  const candidates = findObjects(data, (item) => {
    return item.id && item.rentPrice !== undefined && item.area !== undefined && item.address;
  });
  const home = house.houseInfo || candidates[0] || {};
  const markers = house.markers || home.address || {};
  const pricing = Array.isArray(home.pricingInfos) ? home.pricingInfos[0] : home.pricingInfos || {};
  const title = data?.props?.pageProps?.seoData?.title
    || pickFirst(home, ["title", "shortDescription"])
    || data?.props?.pageProps?.initialProps?.title
    || "";
  const description = home.generatedDescription?.shortRentDescription || home.generatedDescription?.longDescription || "";
  const address = home.address || {};
  const lat = numberFrom(markers.lat);
  const lng = numberFrom(markers.lng);
  const targetDistanceKm = lat && lng ? distanceKm(TARGET, { lat, lng }) : 0;
  const photos = Array.isArray(home.photos)
    ? home.photos.slice(0, 12).map((photo) => ({
      url: photo.url?.startsWith("http") ? photo.url : `https://www.quintoandar.com.br/img/med/${photo.url}`,
      subtitle: photo.subtitle || "",
      cover: Boolean(photo.cover)
    }))
    : [];

  return {
    id: String(pickFirst(home, ["id", "houseId"]) || data?.query?.houseId || Date.now()),
    title: title.replace(" - QuintoAndar", "") || `QuintoAndar ${data?.query?.houseId || ""}`.trim(),
    neighborhood: pickFirst(address, ["neighborhood", "regionName", "cityNeighborhood"]) || "Itaim Bibi",
    url: pickFirst(home, ["canonicalUrl", "url"]) || fallbackUrl,
    rent: numberFrom(pickFirst(pricing, ["rent", "rentValue", "price", "monthlyRent"]) || pickFirst(home, ["rentPrice", "rent", "rentValue", "price"])),
    condo: numberFrom(pickFirst(pricing, ["condo", "condominium", "condominiumFee"]) || pickFirst(home, ["condoPrice", "condo", "condominium", "condominiumFee"])),
    iptu: numberFrom(pickFirst(pricing, ["iptu", "iptuFee", "propertyTax"]) || pickFirst(home, ["iptu", "iptuPrice", "iptuFee", "propertyTax"])),
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
    notes: description
  };
}

async function scrape(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const html = await response.text();
  return extractHome(extractNextData(html), response.url || url);
}

async function main() {
  const homes = [];
  for (const url of URLS) {
    console.log(`Scraping ${url}`);
    homes.push(await scrape(url));
  }

  const state = {
    target: TARGET,
    homes,
    weights: {
      cost: 22,
      valuePerSqm: 14,
      targetDistance: 22,
      area: 8,
      bedrooms: 5,
      bathrooms: 4,
      parking: 4,
      transit: 8,
      safety: 6,
      condition: 5,
      lightNoise: 2
    }
  };

  await fs.writeFile(path.join(__dirname, "scraped-data.json"), JSON.stringify(state, null, 2));
  console.table(homes.map((home) => ({
    id: home.id,
    rent: home.rent,
    condo: home.condo,
    iptu: home.iptu,
    area: home.area,
    rooms: home.bedrooms,
    baths: home.bathrooms,
    parking: home.parking,
    km: home.targetDistanceKm
  })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
