#!/usr/bin/env node
/**
 * merge-candidates.js
 * Lê os imóveis encontrados em new-candidates.json e os incorpora ao
 * ranking-com-candidatos.json e ao index.html (bloco seedHomes).
 * Chamado automaticamente pelo workflow do GitHub Actions após search-new-candidates.js.
 */

const fs = require("fs/promises");
const path = require("path");

const ROOT = __dirname;

async function readJson(filename) {
  const raw = await fs.readFile(path.join(ROOT, filename), "utf8");
  return JSON.parse(raw);
}

async function main() {
  // ── 1. Ler novos candidatos ───────────────────────────────────────────────
  let newData;
  try {
    newData = await readJson("new-candidates.json");
  } catch {
    console.log("⚠️  new-candidates.json não encontrado. Nada a fazer.");
    process.exit(0);
  }

  const newHomes = newData.homes || [];

  if (newHomes.length === 0) {
    console.log("ℹ️  Nenhum candidato novo em new-candidates.json. Nada a mesclar.");
    process.exit(0);
  }

  console.log(`📥 ${newHomes.length} novos candidatos encontrados em new-candidates.json`);

  // ── 2. Ler ranking atual ──────────────────────────────────────────────────
  let rankingData;
  try {
    rankingData = await readJson("ranking-com-candidatos.json");
  } catch {
    console.error("❌ ranking-com-candidatos.json não encontrado.");
    process.exit(1);
  }

  const existingHomes = rankingData.homes || [];
  const existingIds = new Set(existingHomes.map((h) => String(h.id)));

  // ── 3. Filtrar apenas os realmente novos ──────────────────────────────────
  const toAdd = newHomes.filter((h) => !existingIds.has(String(h.id)));

  if (toAdd.length === 0) {
    console.log("ℹ️  Todos os candidatos novos já estão no ranking. Nada a mesclar.");
    process.exit(0);
  }

  console.log(`✨ ${toAdd.length} imóveis genuinamente novos serão adicionados:`);
  toAdd.forEach((h) =>
    console.log(
      `   • ${h.id} | ${h.neighborhood} | R$${(h.rent || 0).toLocaleString("pt-BR")} | ${h.area}m² | ${h.bedrooms}q`
    )
  );

  // ── 4. Mesclar e salvar ranking-com-candidatos.json ───────────────────────
  const allHomes = [...existingHomes, ...toAdd];
  rankingData.homes = allHomes;
  rankingData.updated_at = new Date().toISOString();

  await fs.writeFile(
    path.join(ROOT, "ranking-com-candidatos.json"),
    JSON.stringify(rankingData, null, 2)
  );
  console.log(`✅ ranking-com-candidatos.json atualizado (${allHomes.length} imóveis no total)`);

  // ── 5. Atualizar seedHomes no index.html ──────────────────────────────────
  const htmlPath = path.join(ROOT, "index.html");
  let html = await fs.readFile(htmlPath, "utf8");

  // Marcadores que identificam o bloco seedHomes no HTML
  const OPEN_MARKER = "    const seedHomes = [";
  const CLOSE_MARKER = "\n    ];";

  const startIdx = html.indexOf(OPEN_MARKER);
  if (startIdx === -1) {
    console.error("❌ Marcador 'const seedHomes = [' não encontrado no index.html");
    process.exit(1);
  }

  const endIdx = html.indexOf(CLOSE_MARKER, startIdx + OPEN_MARKER.length);
  if (endIdx === -1) {
    console.error("❌ Fechamento '\\n    ];' do seedHomes não encontrado no index.html");
    process.exit(1);
  }

  // Gera o JSON com indentação compatível com o restante do arquivo
  const homesJson = JSON.stringify(allHomes, null, 6)
    .split("\n")
    .map((line, i) => (i === 0 ? line : "    " + line)) // preserva indentação de 4 espaços base
    .join("\n");

  const newBlock = `    const seedHomes = ${homesJson};`;

  html = html.slice(0, startIdx) + newBlock + html.slice(endIdx + CLOSE_MARKER.length);

  await fs.writeFile(htmlPath, html);
  console.log("✅ index.html atualizado com os novos imóveis no seedHomes");
}

main().catch((err) => {
  console.error("❌ Erro fatal:", err);
  process.exit(1);
});
