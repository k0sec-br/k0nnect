# Auditoria de segurança

Data: 18 de agosto de 2026

Branch: `develop`

Baseline: `b8d6869`
Escopo: frontend, Worker, API, D1, Durable Objects, WebSocket, Realtime/TURN, autenticação, CI/CD, supply chain, deploy, logs e privacidade.

## 1. Executive summary

A arquitetura possui boas fronteiras fundamentais: identidade derivada da sessão, tokens opacos armazenados por hash, SQL parametrizado, schemas runtime estritos, autorização de mídia no servidor e secrets somente em bindings. Não foram confirmados findings `CRITICAL` ou `HIGH`.

A auditoria confirmou quatro findings `MEDIUM`: corpo JSON sem limite efetivo quando `Content-Length` era omitido; assinaturas Realtime duplicadas concorrentes; WebSocket/mídia sobrevivendo à revogação server-side; e enumeração repetível de usernames por portador de convite. Todos receberam correção e teste de regressão. Hardening adicional foi aplicado a Origin/Host, cookie, caracteres de controle, RIDs, timeouts, cache, secrets locais e CI.

O veredito é **READY FOR PRIVATE PRODUCTION**. A exposição pública ampla depende de confirmar no painel Cloudflare/GitHub a proteção do ambiente de produção e observar o fechamento best-effort das tracks em testes reais de queda de rede. A versão pública continuava no baseline durante esta auditoria; as correções exigem deploy separado.

## 2. Superfície de ataque

| Fronteira         | Entradas                                  | Estado/saídas                     | Controles                                                                |
| ----------------- | ----------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| Assets React      | rota, hash do convite, formulários, mídia | DOM, memória, WebRTC              | React escaping, CSP, token removido da URL, sem source maps              |
| API pública       | config, login, recovery, convite          | D1, cookie, Turnstile             | Origin, schemas, corpo limitado, rate limit, mensagens genéricas         |
| API autenticada   | sessão, logout, recovery codes, salas     | sessão e D1                       | cookie `__Host-`, CSRF, role e DTOs explícitos                           |
| Administração     | listar/criar/revogar convites             | D1                                | owner/admin server-side; admin não cria admin/owner                      |
| WebSocket         | upgrade e mensagens                       | attachment efêmero do `VoiceRoom` | sessão, Origin, sala, schema, 4 KiB, janela e revalidação                |
| Realtime          | create/turn/publish/subscribe/close       | Cloudflare SFU/TURN               | sessão, conexão, sala, registry, reserva atômica e limites por ação      |
| D1                | statements preparados e migrations        | contas, hashes, sessões, convites | FK, UNIQUE, CHECK, batches transacionais e updates condicionais          |
| Serviços externos | Siteverify, Realtime e TURN               | respostas transitórias            | secrets no Worker, hostname/action, schemas, tamanho e timeout           |
| Operação          | cron, Wrangler, CI e Git                  | deploy e limpeza                  | lockfile congelado, audit, Actions por SHA, deploy manual no repositório |

## 3. Risk register

| ID          | Severidade | Componente       | Problema                                                                 | Impacto                                                                                  | Status                                    |
| ----------- | ---------- | ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| K0-2026-001 | MEDIUM     | API              | limite JSON dependia de `Content-Length`                                 | um request chunked podia aproximar o limite de 100 MB da plataforma e pressionar memória | Corrigido                                 |
| K0-2026-002 | MEDIUM     | Realtime/DO      | subscribe concorrente não reservava publication                          | tracks remotas órfãs, consumo e custo provocados por usuário autenticado                 | Corrigido                                 |
| K0-2026-003 | MEDIUM     | Sessão/WebSocket | revogação não encerrava socket/mídia negociada                           | presença e mídia podiam continuar até desconexão do cliente                              | Corrigido com janela residual de até 60 s |
| K0-2026-004 | MEDIUM     | Convites         | colisão de username preservava convite                                   | portador podia enumerar usernames existentes repetidamente                               | Corrigido                                 |
| K0-2026-005 | LOW        | Origin           | decisão considerava `X-Forwarded-Host`                                   | confiança desnecessária em header do cliente fora do caminho Cloudflare esperado         | Corrigido                                 |
| K0-2026-006 | LOW        | Secrets locais   | `.dev.vars` podia nascer com `0644`                                      | leitura local por outro usuário do host                                                  | Corrigido                                 |
| K0-2026-007 | LOW        | Schemas          | RID arbitrário e controles/bidi no display name                          | erros upstream e spoofing visual limitado                                                | Corrigido                                 |
| K0-2026-008 | LOW        | Supply chain     | Actions referenciadas por tag mutável                                    | comprometimento de tag alteraria código executado no CI                                  | Corrigido                                 |
| K0-2026-009 | LOW        | Cache            | shell HTML recebia cache público com revalidação                         | persistência desnecessária do shell no navegador                                         | Corrigido                                 |
| K0-2026-010 | INFO       | Documentação     | PBKDF2/cooldown/logs/RIDs não correspondiam ao código                    | avaliação operacional incorreta dos controles                                            | Corrigido                                 |
| K0-2026-011 | LOW        | Password storage | PBKDF2 usa 100 mil iterações                                             | resistência offline inferior a KDFs memory-hard se D1 e pepper forem comprometidos       | Aceito/monitorar                          |
| K0-2026-012 | LOW        | Deploy           | proteção do environment/integração Git não é representada no repositório | push autorizado em `develop` pode publicar sem gate externo comprovado                   | Requer verificação operacional            |

## 4. Evidência e correções

### K0-2026-001 — corpo JSON

- Arquivo/função: `worker/http.ts:24`, `parseJson`.
- Cenário: enviar JSON acima de 1 MiB sem `Content-Length`.
- Esperado: `413` antes de alocar o corpo completo.
- Observado no baseline: o header ausente virava zero e `request.json()` consumia o corpo.
- Correção: leitura incremental por stream, cancelamento acima do limite, UTF-8 fatal e `application/json` obrigatório.
- Regressão: `tests/integration/security.test.ts` cobre ausência de tamanho e content type incorreto.

### K0-2026-002 — duplicação de subscribe

- Arquivos/funções: `worker/durable/voice-room.ts:353`, `reserveSubscription`; `worker/routes/realtime-routes.ts:116`.
- Cenário: duas requisições simultâneas para a mesma publicação.
- Esperado: um único vencedor antes da chamada externa.
- Observado no baseline: ambas chamavam `/tracks/new`; o registry substituía apenas o `mid` depois.
- Correção: reserva, conclusão e cancelamento atômicos no DO; limites separados para session, TURN e mídia.
- Regressão: corrida com duas reservas, completion, take e tentativa cross-room em `tests/integration/websocket.test.ts`.

### K0-2026-003 — revogação e cleanup

- Arquivos/funções: `worker/durable/voice-room.ts:240`, `alarm`; `worker/durable/voice-room.ts:543`, `cleanupRealtime`.
- Cenário: revogar sessão/conta com WebSocket e tracks ativos.
- Esperado: socket fechado e tracks conhecidas removidas.
- Observado no baseline: HTTP subsequente falhava, mas o socket e a negociação existente não eram revogados pelo servidor.
- Correção: session ID interno no attachment, revalidação D1 a cada minuto, close `4003` e fechamento best-effort de mids conhecidos.
- Regressão: sessão revogada seguida de alarm fecha o WebSocket em `tests/integration/websocket.test.ts`.

### K0-2026-004 — enumeração com convite

- Arquivo/função: `worker/services/auth-service.ts:66`, `registerWithInvite`.
- Cenário: portador tenta usernames existentes; colisões preservavam o convite.
- Esperado: convite não funciona como oracle repetível.
- Observado no baseline: número ilimitado de colisões ao longo do tempo, limitado apenas por throttling.
- Correção: primeira tentativa estruturalmente válida cria o usuário ou revoga o convite no mesmo batch.
- Regressão: colisão revoga o convite e replay com username disponível falha em `tests/integration/auth-hardening.test.ts`.

## 5. Autenticação

- Login usa resposta genérica e derivação dummy para conta inexistente.
- Senhas têm 12–128 caracteres; a exigência também aparece no frontend.
- PBKDF2-HMAC-SHA-256 usa salt aleatório de 128 bits, pepper em binding, 100 mil iterações e comparação constante.
- Rate limit global, por IP e por username normalizado ocorre antes da verificação de senha; Turnstile entra de forma adaptativa.
- Conta `disabled` não cria nem carrega sessão.
- Não há bypass, usuário fake ou flag de debug ativável em produção.

## 6. Sessões

- Token de 256 bits; somente SHA-256 no D1.
- Cookie `__Host-k0nnect_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sem `Domain`.
- Login e regeneração rotacionam sessão; login revoga token atual apresentado.
- Expiração ociosa de sete dias e absoluta de trinta dias.
- Cookie fora do formato é apagado antes da consulta D1.
- Logout e logout-all revogam no D1; WebSocket revalida em até 60 segundos.
- Fixation e replay da sessão anterior possuem regressão automatizada.

## 7. Convites e recovery

- Tokens e recovery codes têm alta entropia, aparecem uma vez e persistem somente como hash.
- Fragmento `#` impede envio do convite na navegação e é removido imediatamente do endereço.
- Convite e recovery são single-use por updates condicionais em batch D1.
- Corridas produzem exatamente um vencedor.
- Recovery troca senha, revoga sessões e substitui todos os códigos.
- Login e recovery não oferecem enumeração prática sem autenticação; convite válido permite apenas uma tentativa estruturalmente válida.

## 8. API e D1

- Todas as queries de produção usam placeholders/bindings; não foi encontrada concatenação de entrada em SQL.
- Schemas Zod são runtime, estritos e limitam tamanho/tipo.
- DTOs são montados explicitamente; hashes, salts, tokens e campos internos não chegam ao cliente.
- Não há mass assignment, upload, redirect configurável ou fetch para URL do usuário; SSRF, upload e open redirect são não aplicáveis.
- FKs, UNIQUE e CHECK foram exercitados após todas as migrations; `PRAGMA foreign_key_check` não retornou violações.
- Respostas autenticadas e API usam `Cache-Control: no-store`.

## 9. WebSocket e Durable Objects

- Upgrade exige cookie válido, Origin exata, sala existente e rate limit por IP/usuário.
- Headers internos são reconstruídos pelo Worker; mensagens do cliente não aceitam `userId` ou role.
- Protocol version, schema estrito, 4 KiB, três mensagens inválidas e 50 mensagens/10 s são aplicados.
- Attachment serializado mantém identidade durante hibernação.
- Conexão substituída e revogação removem presença/publicações e iniciam cleanup.

## 10. WebRTC e Realtime

- `publicationId` é resolvido somente dentro do DO nomeado pela sala; teste cross-room falha.
- Track name e session ID remoto não são devolvidos na publicação pública.
- O session ID local é opaco e só opera quando vinculado ao user, connection e room atuais.
- Limites: um microfone, uma câmera, um vídeo de tela e um áudio de tela; áudio de tela depende do vídeo.
- Subscribe tem reserva atômica; RID aceita somente `a`, `b` ou `c`.
- TURN retorna credenciais temporárias de uma hora; chave permanente permanece no Worker.
- Câmera/tela dependem de gesto; tela usa `getDisplayMedia`, limpa `ended` e não grava conteúdo.
- Mídia não é persistida e não há E2EE de aplicação.

## 11. Frontend

- Não há `dangerouslySetInnerHTML`, `innerHTML`, `eval` ou `document.write`.
- Conteúdo de usuário é texto React; payload XSS permanece texto.
- Convite e recovery codes ficam em memória; não usam localStorage.
- localStorage guarda somente preferência de device ID.
- Clipboard é escrito somente por ação explícita e nunca é lido.
- CSP não contém `unsafe-eval`, wildcard nem inline; framing e object são bloqueados.
- Source maps de produção estão desabilitados.

## 12. Cloudflare

- `compatibility_date` é recente, `nodejs_compat` está explícito e tipos foram regenerados.
- D1 e os dois DOs usam bindings; não há secret em `vars`.
- Os seis nomes de secrets esperados estão presentes no Worker de produção; valores não foram lidos.
- Migrations remotas não possuem pendência.
- Produção retornou HSTS, CSP, Permissions-Policy, nosniff, no-referrer, DENY/`frame-ancestors`, COOP/CORP e ausência de CORS.
- Origin maliciosa recebeu `403`; preflight externo não ganhou CORS; sessão anônima não vazou estado.
- Turnstile valida server-side, hostname e action; tokens do provedor são single-use e expiram.

## 13. Supply chain e CI/CD

- `pnpm-lock.yaml` está commitado; CI usa `--frozen-lockfile`.
- `pnpm audit` reportou zero vulnerabilidades em 298 pacotes auditados.
- As quatro dependências runtime são usadas; nenhuma biblioteca runtime abandonada foi identificada.
- Actions oficiais estão fixadas por SHA; checkout não persiste credenciais.
- CI possui `contents: read`, não usa secrets e não usa `pull_request_target`/`workflow_run`.
- Dependabot cobre npm e GitHub Actions na `develop`.
- O repositório não possui workflow de deploy. A proteção da integração Cloudflare conectada ao Git precisa ser confirmada no painel.

## 14. Secrets, logs e privacidade

- Working tree, histórico e bundle foram varridos sem imprimir valores.
- Dois candidatos históricos foram classificados como não secretos: site key pública Turnstile e hash dummy de timing.
- Bundle do navegador não contém valores nem nomes dos bindings secretos; não há `.env`, `.dev.vars` ou source map.
- `.dev.vars` e `.dev.vars.production` locais estão em `0600`, ignorados pelo Git; setup preserva esse modo.
- Logger da aplicação aceita somente evento, request ID, rota, status, user/room ID e classe de erro. Não registra body, senha, cookie, token, SDP, ICE, device label ou mídia.
- Cloudflare processa IP e metadados de transporte conforme a infraestrutura; a aplicação usa hash keyed do IP somente para rate limit e não persiste IP bruto.
- Não existe TURN residencial nem IP de mantenedor configurado.

## 15. Perguntas objetivas

| Pergunta                                | Resposta                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Não autenticado entra em sala?          | Não; lista, join e WebSocket exigem sessão.                                            |
| Member executa admin?                   | Não; `requireRole` server-side e testes diretos retornam `403`.                        |
| Admin vira owner sozinho?               | Não; não há endpoint de mudança de role e admin só cria member.                        |
| Convite pode ser reutilizado?           | Não; update condicional e teste de corrida/replay.                                     |
| Recovery code pode ser reutilizado?     | Não; um vencedor, troca do conjunto e replay recusado.                                 |
| Há session fixation?                    | Não confirmada; login/regeneração rotacionam e revogam a anterior.                     |
| Há user enumeration?                    | Não de forma pública prática; convite permite uma única tentativa válida.              |
| Há SQL injection?                       | Não confirmada; schemas e statements preparados em todas as queries.                   |
| Há XSS?                                 | Não confirmada; sem sinks HTML e React escapa conteúdo.                                |
| Há CSRF?                                | Protegido por SameSite, Origin exata e token em mutações autenticadas.                 |
| Há IDOR?                                | Não confirmada nos recursos existentes; identidade e mídia são resolvidas server-side. |
| Assina mídia de outra sala?             | Não; registry isolado pelo nome do DO e teste cross-room.                              |
| Finge outro usuário no WebSocket?       | Não; identidade vem da sessão e schema rejeita `userId`.                               |
| Publica tracks arbitrariamente?         | Não; source allowlist, ownership e limite de uma por fonte.                            |
| Recupera secrets pelo frontend?         | Não; bundle verificado sem valores ou nomes dos bindings.                              |
| Mídia é armazenada?                     | Não pela aplicação; é processada transitoriamente pelo SFU/TURN.                       |
| Token sensível vai para logs?           | Não foi encontrado caminho de logging de token.                                        |
| IP residencial do mantenedor é exposto? | Não; mídia usa serviços Cloudflare.                                                    |
| Dependência vulnerável é explorável?    | Nenhuma advisory foi reportada no audit atual.                                         |

## 16. Testes e comandos

Executados localmente:

```text
pnpm test:security
pnpm check
pnpm audit --json
pnpm build
pnpm exec wrangler types --check
pnpm exec wrangler check startup --env production
pnpm exec wrangler secret list --env production
pnpm exec wrangler d1 migrations list k0nnect --remote --env production
```

Resultados finais:

- `pnpm check`: passou; 13 arquivos e 65 testes, tipos Wrangler atualizados e build concluído;
- `pnpm test:security`: passou; 8 arquivos e 40 testes adversariais dentro da seleção;
- `pnpm test:e2e`: passou; 4 fluxos Chromium;
- `pnpm audit --json`: zero advisories em 298 dependências totais;
- `pnpm deploy:dry-run`: passou; Worker 252,75 KiB e 13 assets reconhecidos;
- bundle do navegador: zero valores de secret, zero nomes de bindings secretos e zero source maps;
- D1 remoto: nenhuma migration pendente.

Black-box não destrutivo em `https://connect.k0sec.org`:

```text
GET /
GET /api/config
GET /api/auth/session
GET /api/does-not-exist
OPTIONS /api/auth/login com Origin externo
POST /api/auth/login com Origin externo e credencial fictícia
```

Testes automatizados cobrem auth bypass, roles, CSRF, SQLi de entrada, mass assignment, prototype keys, invite/recovery race e replay, fixation, revogação, rate limit/`Retry-After`, cookie inválido, D1, WebSocket impersonation/flooding, cross-room e reserva de mídia.

## 17. Riscos residuais

1. PBKDF2 em 100 mil iterações depende fortemente do segredo do pepper e da política de senha; avaliar KDF memory-hard quando o runtime/plataforma oferecer uma opção operacionalmente segura.
2. Revalidação de WebSocket possui janela máxima de 60 segundos. Fechamento de tracks é best-effort porque a API SFU expõe fechamento por track, não encerramento integral de sessão.
3. Proteções de branch, environment approval, WAF/Bot Management e regras da integração Git vivem fora do repositório e precisam de evidência no painel.
4. Não houve stress test em produção. Limites volumétricos de camada 7 e custos reais de SFU precisam de monitoramento.
5. Não existe E2EE de aplicação; Cloudflare processa a mídia em trânsito.

## 18. Veredito

**READY FOR PRIVATE PRODUCTION**

Não há finding crítico/alto confirmado e os findings médios possuem correção e regressão. O produto pode operar de forma invite-only com grupo controlado após deploy destas mudanças. O salto para exposição pública ampla exige validar gates externos de deploy e observar revogação/cleanup de mídia em produção real.
