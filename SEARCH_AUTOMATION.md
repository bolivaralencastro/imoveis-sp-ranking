# Automação de busca de imóveis

`search-new-candidates.js` busca imóveis do QuintoAndar por recortes geográficos próximos à Meta Faria Lima e aplica os critérios de preço, área, quartos, distância e bairro.

## Ruas preferidas

A busca também mantém uma lista de `preferredStreets` dentro de `CRITERIA`. Quando um imóvel coletado expõe a rua no anúncio, o script marca:

```json
"preferredStreet": true,
"preferredStreetName": "Rua Coronel Artur de Paula Ferreira"
```

Essas ruas não substituem os filtros principais, mas ajudam a identificar oportunidades nas regiões escolhidas visualmente no mapa. Se o bairro vier fora da lista permitida, uma rua-alvo ainda permite que o imóvel passe pelo filtro.

## Regiões cobertas

Além de Itaim Bibi, Vila Olímpia, Jardim Europa e Jardins, a busca agora inclui Vila Nova Conceição e dois recortes extras:

- Vila Nova Conceição / Moema norte
- Jardins / Jardim Europa - ruas preferidas

Para adicionar novas ruas, edite `CRITERIA.preferredStreets` em `search-new-candidates.js`.

## Busca independente por ruas

`search-street-candidates.js` roda uma busca separada usando páginas do QuintoAndar por nome de rua, por exemplo:

```text
https://www.quintoandar.com.br/alugar/imovel/rua-coronel-artur-de-paula-ferreira-vila-nova-conceicao-sao-paulo-sp-brasil/
```

Essa busca não depende dos bairros da busca principal. Ela coleta IDs das páginas de cada rua, abre cada anúncio e só aprova imóveis cuja rua real extraída do anúncio bate exatamente com a lista de ruas definida em `STREET_SEARCHES`.

Ela grava:

- `street-candidates.json`: resultado completo da rodada, incluindo aprovados, rejeitados e falhas.
- `new-candidates.json`: apenas os aprovados, pronto para `node merge-candidates.js`.

Para evitar imóveis em trechos longos fora das capturas, o script rejeita explicitamente Avenida Santo Amaro no Brooklin.
