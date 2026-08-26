# k0nnect

k0nnect é uma plataforma open source, privada e _invite-only_ para conversas em comunidades. A versão 0.3 reúne amizades, mensagens diretas, grupos privados, chat persistente, chamadas, câmera e compartilhamento de tela.

> Status: v0.3 em desenvolvimento. Faça uma revisão operacional e de segurança antes de hospedar para terceiros.

## Stack e arquitetura

- React 19, TypeScript estrito e Vite nas interfaces web e nativas;
- Tauri 2 e Rust para os clientes Windows/Linux/macOS e Android;
- Hono em Cloudflare Workers para a API;
- D1 para usuários, amizades, grupos, mensagens, convites e sessões;
- Durable Objects com WebSocket Hibernation para presença e limitação de abuso;
- Cloudflare Realtime SFU e TURN para o plano de mídia;
- Vitest/Workers e Playwright para testes.

O Worker e os Durable Objects formam o plano de controle; áudio e vídeo seguem entre o cliente e o Realtime SFU. Cada instância usa um WebSocket, e cada participante em chamada usa uma única sessão e uma única `RTCPeerConnection`. Veja [docs/architecture.md](docs/architecture.md), [docs/native-clients.md](docs/native-clients.md), [docs/social.md](docs/social.md) e [docs/chat.md](docs/chat.md).

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

### Cliente nativo

O shell Tauri usa os assets locais gerados pelo Vite e o backend oficial em `https://connect.k0sec.org`. Depois de instalar os [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/):

```bash
pnpm desktop:dev
pnpm desktop:build
pnpm android:init
pnpm android:dev
```

O processo de assinatura, atualização e publicação está em [docs/native-clients.md](docs/native-clients.md).

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

Os checklists de voz e vídeo reais estão em [docs/manual-realtime-test.md](docs/manual-realtime-test.md) e [docs/manual-video-test.md](docs/manual-video-test.md).

## Deploy

Recursos externos e a sequência segura estão documentados em [docs/deployment.md](docs/deployment.md). O comando de deploy é deliberadamente manual:

```bash
pnpm deploy:dry-run
pnpm deploy
```

O repositório não faz deploy de pull requests nem entrega secrets a forks.

## Privacidade e segurança

k0nnect não possui analytics, tracking, email, telefone ou gravação. Armazena identidade escolhida, relações sociais, grupos, mensagens de texto, hashes de credenciais, sessões, role e metadados operacionais mínimos. Microfone, câmera, tela e áudio da tela são processados transitoriamente pelo Realtime e não são persistidos pela aplicação. Leia [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md) e [docs/threat-model.md](docs/threat-model.md).

## Contribuição e licença

Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir uma mudança. O projeto usa AGPL-3.0-or-later; serviços modificados oferecidos em rede devem disponibilizar o código-fonte correspondente conforme a licença.
