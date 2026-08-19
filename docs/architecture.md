# Arquitetura

```text
                         Cloudflare

                    ┌────────────────┐
                    │ Worker         │
                    │                │
                    │ /api/bootstrap │
                    │ auth/social    │
                    │ media control  │
                    └───────┬────────┘
                            │
                  ┌─────────▼──────────┐
                  │ ServerRealtime DO  │
                  │ server = k0sec     │
                  │                    │
                  │ presence + chat    │
                  │ voice membership   │
                  │ call leases        │
                  │ publications       │
                  └─────────┬──────────┘
                            │
                       1 WebSocket
                            │
                  ┌─────────▼─────────┐
                  │ Client           │
                  └─────────┬─────────┘
                            │
                          WebRTC
                            │
                  ┌─────────▼─────────┐
                  │ Realtime SFU     │
                  └───────────────────┘

D1: identidade, amizades, conversas, mensagens e autorização persistente.
```

## Planos

- **Persistent plane:** D1 guarda contas, hashes de credenciais, sessões, convites, amizades, conversas, associações e mensagens. Presença, call, speaking e mídia ativa não produzem writes no D1.
- **Control plane:** o Worker autentica e autoriza a conexão. Um `ServerRealtime` mantém presença, entrega de chat, capacidades sociais, participantes, call leases, estado de mute/deafen e o registro efêmero de publicações. O navegador mantém um WebSocket hibernável por aba.
- **Media plane:** o navegador negocia uma única `RTCPeerConnection` com o Cloudflare Realtime SFU durante a call. Microfone, câmera, tela e áudio da tela usam tracks independentes na mesma sessão. Secrets e chamadas privilegiadas permanecem no Worker.

## Bootstrap e estado realtime

`GET /api/bootstrap` entrega os dados persistentes pequenos necessários para iniciar a interface: identidade, canais autorizados, membros, amigos, solicitações e resumos de conversas. O endpoint não retorna credenciais, sessões, hashes, tokens de convite ou histórico de mensagens e mídia.

Depois do bootstrap, o WebSocket envia um snapshot exclusivamente efêmero com usuários online e, quando aplicável, participantes e publicações da call ativa. Mudanças usam deltas de presença, chat, estado social, membership, call e mídia. A resposta HTTP atualiza quem iniciou uma mutação social, e o mesmo WebSocket atualiza as demais conexões afetadas. Reconnect solicita apenas o snapshot efêmero e não repete bootstrap.

Abrir a aplicação estabelece presença, mas não entra em um canal de voz e não cria sessão SFU. A call começa somente após `call.join` explícito pelo WebSocket. Sair envia `call.leave`, libera mídia e lease, mas preserva a mesma conexão de presença.

## ServerRealtime

O binding `SERVER_REALTIME` é nomeado por `k0sec`. K0Sec, grupos privados e DMs reutilizam essa instância; não existe Durable Object por grupo ou usuário. O objeto não armazena frames ou conteúdo de mídia.

Cada transporte possui um `connectionId` aleatório, uma sessão autenticada e um attachment hibernável. O attachment contém os IDs autorizados de conversas, amizades e salas de chamada. A presença é agregada por usuário: múltiplas abas ou dispositivos geram um único membro online. Uma conta mantém no máximo uma call ativa; outra conexão recebe conflito ou pode transferir o lease com `call.takeover`.

Uma queda inesperada suspende a conexão lógica por 45 segundos. A retomada autenticada exige o mesmo usuário, sessão, `connectionId` e um `connectionEpoch` maior. O estado mínimo suspenso fica no storage do Durable Object até o fim do grace period. Fechamento explícito remove imediatamente call e presença quando essa era a última conexão.

O WebSocket usa Hibernation API e não mantém heartbeat ou watchdog periódico da aplicação. Attachments reconstroem identidade e ownership após hibernação. Alarms são agendados somente para grace period ou para o limite real de validade/ociosidade da sessão. Logout, logout global, recuperação e rotação de sessão notificam o Durable Object para revogação imediata.

## Registro de publicações

O `ServerRealtime` associa cada `publicationId` opaco ao usuário, conexão, canal, sessão Realtime, track interna, `mid`, tipo e fonte. O frontend recebe apenas metadados públicos. Reservas atômicas impedem publicações e subscriptions duplicadas; falhas cancelam a reserva.

Publicações e subscriptions aceitam batches. Vídeo e áudio de uma tela compartilham uma negociação HTTP/SFU. Ao entrar, o snapshot já informa todas as publicações existentes; o cliente prioriza microfone, áudio de tela, vídeo de tela e câmera ao assinar.

## Fronteiras de segurança

O navegador recebe cookie opaco HttpOnly e token CSRF em memória. Mutações HTTP atravessam Origin, CSRF, schema, autorização e rate limit. O upgrade WebSocket valida sessão, Origin, servidor e limites antes de injetar identidade em headers internos ao Durable Object. Mensagens do cliente não aceitam `userId`, role, nomes de tracks do SFU ou secrets.

D1 continua sendo a fonte de verdade para identidade, sessão, role, amizades, conversas, membros e mensagens. O `ServerRealtime` mantém estado efêmero autorizado e persiste cada envio canônico no D1. Operações SDP permanecem em HTTP porque a resposta precisa atualizar a `RTCPeerConnection` do navegador e pode ultrapassar o limite compacto do protocolo de controle.

Consulte [social-chat.md](social-chat.md), [realtime.md](realtime.md), [connection-lifecycle.md](connection-lifecycle.md) e [realtime-request-budget.md](realtime-request-budget.md).
