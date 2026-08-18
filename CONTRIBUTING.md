# Contribuindo

Obrigado por ajudar o k0nnect. Use Node.js 22+, pnpm 11 e trabalhe a partir de uma branch criada sobre `develop`.

1. Instale com `pnpm install --frozen-lockfile`.
2. Execute `pnpm setup:local` e `pnpm db:migrate:local`.
3. Faça uma mudança pequena, sem credenciais ou dados pessoais.
4. Adicione testes proporcionais ao risco.
5. Execute `pnpm check` e, para fluxos de interface, `pnpm test:e2e`.
6. Use Conventional Commits, por exemplo `fix: reject expired sessions`.

Mantenha TypeScript estrito, entradas validadas por schema, SQL parametrizado e mensagens de usuário sem detalhes internos. Mudanças em autenticação, autorização, cookies, criptografia, Realtime ou migrations precisam explicar riscos, compatibilidade e como foram testadas.

Vulnerabilidades não devem ser abertas como issue pública. Siga [SECURITY.md](SECURITY.md).
