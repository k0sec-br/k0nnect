# Deploy no Cloudflare

## Recursos externos ainda necessários

Uma instalação nova precisa de conta/domínio Cloudflare, banco D1 `k0nnect`, Durable Objects (criados pelo deploy/migration), aplicação Cloudflare Realtime, chave TURN, widget Turnstile e rota `connect.k0sec.org`. Nenhum desses recursos é criado neste repositório local.

## Preparação

1. Autentique o Wrangler e crie/confirme o D1. Se sua conta exigir identificador explícito, adicione o `database_id` retornado ao binding `DB` de produção; nunca invente um ID.
2. Crie Realtime SFU e TURN no painel/API Cloudflare.
3. Crie um widget Turnstile restrito a `connect.k0sec.org` e coloque somente a site key pública em `TURNSTILE_SITE_KEY`.
4. Configure cada secret:

```bash
pnpm exec wrangler secret put PASSWORD_PEPPER --env production
pnpm exec wrangler secret put TURNSTILE_SECRET --env production
pnpm exec wrangler secret put REALTIME_APP_ID --env production
pnpm exec wrangler secret put REALTIME_APP_SECRET --env production
pnpm exec wrangler secret put TURN_KEY_ID --env production
pnpm exec wrangler secret put TURN_KEY_API_TOKEN --env production
```

Use um pepper aleatório de pelo menos 32 bytes e guarde backup seguro. Perder ou trocar esse valor sem migração invalida verificações de senha.

## Validação e publicação

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:security
pnpm test:e2e
pnpm audit:dependencies
pnpm deploy:dry-run
pnpm db:migrate:remote
pnpm deploy
pnpm invite:create -- --role owner --remote
```

Revise `git status`, a branch e o dry-run antes da migration. Gere o primeiro owner em um canal privado; o token aparece uma vez. Confirme CSP, Turnstile, login, recovery e voz com [manual-realtime-test.md](manual-realtime-test.md).

## Rollback e operação

Antes da migration social, exporte um backup para um diretório seguro fora do repositório:

```bash
pnpm exec wrangler d1 export k0nnect --remote --env production --output /caminho/seguro/k0nnect-before-social.sql
pnpm db:migrate:remote
```

Valide no banco migrado a associação de todas as contas ativas ao `group_k0sec` antes de publicar o Worker. A migration social é aditiva, mas o rollback do schema exige restaurar o backup e descarta amizades, grupos e mensagens criados depois dele. Uma versão antiga do Worker não conhece autorização de grupos privados e não deve ser publicada sobre o schema social com dados reais. Prefira uma correção forward compatível.

Workers podem voltar a uma versão compatível, e migrations D1 precisam de plano de correção aditivo. O cron diário remove somente dados expirados/revogados. Monitore erros agregados por request ID sem registrar credenciais, mensagens ou mídia.

Antes de cada release, inspecione `dist/client` procurando valores reais dos secrets e padrões de token. Nomes de bindings podem aparecer no artefato Worker; valores não podem aparecer no bundle do navegador. Confirme também que o ambiente ou integração Git usado para produção exige revisão e não publica código de pull requests não confiáveis.
