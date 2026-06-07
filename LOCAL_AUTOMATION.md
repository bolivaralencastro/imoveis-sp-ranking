# Automação local de visitas confirmadas

Esta automação cruza e-mails do Gmail com os imóveis do ranking e cria eventos no Google Calendar.

## O que ela faz

1. Busca no Gmail e-mails de `nao-responda@quintoandar.com.br` com assunto `Eba, sua visita foi confirmada!`.
2. Extrai o ID do imóvel e a data/horário da visita.
3. Atualiza `ranking-com-candidatos.json` e o `seedHomes` do `index.html` com `visit.status = "confirmed"`.
4. Cria um evento no Google Calendar com propriedade privada `quintoAndarHomeId`, evitando duplicatas.

## Configuração OAuth

Crie um OAuth Client do tipo Desktop/Web no Google Cloud com acesso às APIs Gmail e Calendar e salve o JSON como:

```text
.google-oauth-client.json
```

O arquivo deve conter `client_id` e `client_secret`. Ele está no `.gitignore` e não deve ser commitado.

Também é possível usar variáveis de ambiente:

```bash
export GOOGLE_CLIENT_ID="..."
export GOOGLE_CLIENT_SECRET="..."
```

## Rodar manualmente

```bash
node sync-confirmed-visits.js --dry-run
node sync-confirmed-visits.js
```

Na primeira execução, o script abre o navegador para autorizar Gmail + Calendar e salva o token em `.google-token.json`.

## Rodar periodicamente no macOS

Exemplo simples com `cron`, a cada 30 minutos:

```cron
*/30 * * * * cd /Users/Pessoal/imoveis-sp-ranking && /usr/local/bin/node sync-confirmed-visits.js >> sync-confirmed-visits.log 2>&1
```

Se usa `nvm`, prefira apontar para o binário real de `node` retornado por:

```bash
which node
```
