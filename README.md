# k0nnect

k0nnect é uma plataforma open source, privada e _invite-only_ para conversas de voz em comunidades. A versão 0.1 entrega contas sem email, recuperação por códigos de uso único, presença em tempo real e áudio pelo Cloudflare Realtime SFU. Chat, vídeo e compartilhamento de tela não fazem parte desta versão.

> Status: v0.1 em desenvolvimento. Faça uma revisão operacional e de segurança antes de hospedar para terceiros.

## Stack e arquitetura

- React 19, TypeScript estrito e Vite no navegador;
- Hono em Cloudflare Workers para a API;
- D1 para usuários, convites, sessões e metadados;
- Durable Objects com WebSocket Hibernation para presença e limitação de abuso;
- Cloudflare Realtime SFU e TURN para o plano de mídia;
- Vitest/Workers e Playwright para testes.

O Worker e os Durable Objects formam o plano de controle; o áudio segue diretamente entre o navegador e o Realtime SFU. Veja [docs/architecture.md](docs/architecture.md).

## Desenvolvimento local

Requer Node.js 22+ e pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate:local
pnpm invite:create -- --role owner
pnpm dev
```

O último comando de convite imprime o link uma única vez. O token fica no fragmento `#`, é removido do endereço assim que a tela abre e não é enviado em requisições de navegação. O áudio permanece desabilitado localmente; autenticação, convites e presença usam workerd, D1 e um adapter de desenvolvimento isolado.

Não versione `.dev.vars`. Para recriar o ambiente, remova o arquivo conscientemente e execute `pnpm setup:local` outra vez.

## Configuração

Variáveis não secretas ficam em `wrangler.jsonc`:

- `REGISTRATION_MODE=invite` — `public` está reservado e não abre cadastro;
- `REALTIME_ENABLED` — `true` somente com recursos Realtime configurados;
- `TURNSTILE_ENABLED` e `TURNSTILE_SITE_KEY`;
- `APP_ORIGIN` — origem exata aceita para mutações e WebSocket.

Secrets de produção são configurados com `wrangler secret put NOME --env production`: `PASSWORD_PEPPER`, `TURNSTILE_SECRET`, `REALTIME_APP_ID`, `REALTIME_APP_SECRET`, `TURN_KEY_ID` e `TURN_KEY_API_TOKEN`. Nunca coloque valores reais em arquivos ou no frontend.

## Banco e migrations

```bash
pnpm db:migrate:local
pnpm db:migrate:remote
```

Migrations são incrementais em `migrations/`. Faça backup e valide em um ambiente de teste antes de aplicar mudanças remotas.

## Qualidade e testes

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm audit:dependencies
```

O checklist completo de voz real está em [docs/manual-realtime-test.md](docs/manual-realtime-test.md).

## Deploy

Recursos externos e a sequência segura estão documentados em [docs/deployment.md](docs/deployment.md). O comando de deploy é deliberadamente manual:

```bash
pnpm deploy:dry-run
pnpm deploy
```

O repositório não faz deploy de pull requests nem entrega secrets a forks.

## Privacidade e segurança

k0nnect não possui analytics, tracking, email, telefone ou gravação. Armazena somente identidade escolhida pelo usuário, hashes de credenciais, sessões, role e metadados operacionais mínimos. Áudio é processado transitoriamente pelo Realtime e não é persistido pela aplicação. Leia [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md) e [docs/threat-model.md](docs/threat-model.md).

## Contribuição e licença

Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir uma mudança. O projeto usa AGPL-3.0-or-later; serviços modificados oferecidos em rede devem disponibilizar o código-fonte correspondente conforme a licença.
