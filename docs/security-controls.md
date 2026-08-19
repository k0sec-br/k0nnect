# Controles de segurança

| Risco                          | Controle efetivo                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Roubo de credencial persistida | PBKDF2 100k + salt + pepper; tokens armazenados como hash                                   |
| Session fixation               | token opaco aleatório e rotação em login/recuperação/regeneração                            |
| CSRF                           | cookie SameSite, Origin exata e token CSRF independente em toda mutação autenticada         |
| Brute force                    | limites por IP/conta, resposta genérica, derivação dummy e Turnstile adaptativo             |
| Replay                         | consumo condicional de convite/recovery code e testes de corrida                            |
| SQL injection                  | D1 prepared statements; schemas estritos antes do repositório                               |
| XSS                            | React escapa texto, CSP sem inline/eval e nenhuma renderização HTML de conteúdo do usuário  |
| IDOR/role escalation           | identidade da sessão, `requireRole`, sala, conexão e `publicationId` resolvido no servidor  |
| Acesso a conversa/grupo        | associação ativa no D1, capacidades no attachment e atualização imediata orientada a evento |
| Replay de mensagem             | unicidade de `sender_id` + `client_message_id` e resposta canônica idempotente              |
| WebSocket abuse                | autenticação, Origin, schemas, tamanho, janela de mensagens e revalidação de sessão         |
| Vazamento Realtime             | secrets e nomes de track somente no Worker/DO; IDs opacos vinculados à conexão e sala       |
| Abuso de mídia                 | uma track por fonte, assinatura reservada atomicamente e limites por operação               |
| Payload excessivo              | `Content-Type` estrito e leitura streaming limitada antes do parse JSON                     |
| Clickjacking/MIME              | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`                                |

Outros headers incluem HSTS em produção, Referrer-Policy `no-referrer`, Permissions-Policy que libera microfone, câmera e captura de tela somente para `self`, e CSP explícita para Realtime/Turnstile. Não há CORS porque frontend e API são same-origin.

Logs da aplicação usam evento, request ID, rota, status e classe do erro. Não incluem corpos, cookies, tokens, usernames, SDP, ICE candidates ou IPs. Erros inesperados são sanitizados antes da resposta.

O `ServerRealtime` recebe revogações de logout e recuperação por RPC e agenda revalidação no limite real de expiração ou ociosidade da sessão. Mudanças sociais atualizam capacidades de sockets ativos e conexões suspensas; a remoção de um grupo encerra a chamada correspondente. Sessões inválidas e contas desabilitadas têm o WebSocket encerrado. Ao desconectar, o Durable Object solicita o fechamento best-effort das tracks conhecidas no Realtime.

Antes de um deploy, execute `pnpm check`, `pnpm test:security`, `pnpm test:e2e`, `pnpm audit:dependencies` e a busca de secrets descrita em [deployment.md](deployment.md). O registro da auditoria está em [security-audit.md](security-audit.md).
