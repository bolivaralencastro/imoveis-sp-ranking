# Automação local de visitas confirmadas

Esta automação cruza e-mails do Gmail com os imóveis do ranking, cria eventos no Google Calendar e pode publicar a atualização no GitHub.

Ela roda **somente nesta máquina**, usando o Google Workspace CLI local (`gws`) já autenticado em `~/.config/gws`.

## O que ela faz

1. Busca no Gmail e-mails de `nao-responda@quintoandar.com.br` com assunto `Eba, sua visita foi confirmada!`.
2. Extrai o ID do imóvel e a data/horário da visita.
3. Atualiza `ranking-com-candidatos.json` e o `seedHomes` do `index.html` com `visit.status = "confirmed"`.
4. Cria um evento no Google Calendar com propriedade privada `quintoAndarHomeId`, evitando duplicatas.

## Configuração OAuth via GWS

O projeto não guarda credenciais Google. A autenticação fica fora do repositório, no `gws`.

Verifique se o CLI está instalado:

```bash
which gws
gws --help
```

Se precisar autenticar novamente, use o login do próprio CLI:

```bash
gws auth login
```

O `gws` usa `~/.config/gws` para client, token/cache e keyring. Nada disso deve ser commitado.

## Rodar manualmente

```bash
node sync-confirmed-visits.js --dry-run
node sync-confirmed-visits.js
```

Para atualizar o GitHub automaticamente após marcar visitas confirmadas:

```bash
node sync-confirmed-visits.js --push
```

`--dry-run` lê Gmail/Calendar e mostra o que faria, mas não atualiza arquivos nem cria eventos.

`--push` commita `ranking-com-candidatos.json` e `index.html` e faz `git push` se houver mudanças.

## Rodar periodicamente no macOS

Exemplo simples com `cron`, a cada 30 minutos:

```cron
*/30 * * * * cd /Users/Pessoal/imoveis-sp-ranking && /usr/local/bin/node sync-confirmed-visits.js --push >> sync-confirmed-visits.log 2>&1
```

Se usa `nvm`, prefira apontar para o binário real de `node` retornado por:

```bash
which node
```
