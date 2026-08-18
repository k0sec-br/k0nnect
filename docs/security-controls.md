# Controles de segurança

| Risco                          | Controle efetivo                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Roubo de credencial persistida | PBKDF2 600k + salt + pepper; tokens armazenados como hash                                  |
| Session fixation               | token opaco aleatório e rotação em login/recuperação/regeneração                           |
| CSRF                           | cookie SameSite, Origin exata e token CSRF independente em toda mutação autenticada        |
| Brute force                    | limites por IP/conta, cooldown progressivo, resposta genérica e Turnstile adaptativo       |
| Replay                         | consumo condicional de convite/recovery code e testes de corrida                           |
| SQL injection                  | D1 prepared statements; schemas estritos antes do repositório                              |
| XSS                            | React escapa texto, CSP sem inline/eval e nenhuma renderização HTML de conteúdo do usuário |
| IDOR/role escalation           | identidade da sessão, `requireRole`, sala, conexão e `publicationId` resolvido no servidor |
| WebSocket abuse                | autenticação, Origin, schemas, tamanho, contagem inválida e janela de mensagens            |
| Vazamento Realtime             | IDs e secrets internos somente no Worker/DO; respostas públicas validadas e limitadas      |
| Abuso de mídia                 | uma track por fonte/usuário, reserva atômica e limites de publish/close/subscribe          |
| Clickjacking/MIME              | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`                               |

Outros headers incluem HSTS em produção, Referrer-Policy `no-referrer`, Permissions-Policy que libera microfone, câmera e captura de tela somente para `self`, e CSP explícita para Realtime/Turnstile. Não há CORS porque frontend e API são same-origin.

Logs usam request ID, método, rota, status e duração. Não incluem corpos, cookies, tokens, usernames ou IPs. Erros inesperados são sanitizados antes da resposta.

Antes de um deploy, execute `pnpm check`, `pnpm test:e2e`, `pnpm audit:dependencies` e a busca de secrets descrita em [deployment.md](deployment.md).
