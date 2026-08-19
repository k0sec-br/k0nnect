# Arquitetura

```text
                         Cloudflare

                    ┌────────────────┐
                    │ Worker         │
                    │                │
                    │ /api/bootstrap │
                    │ auth/admin     │
                    │ media control  │
                    └───────┬────────┘
                            │
                  ┌─────────▼──────────┐
                  │ ServerRealtime DO  │
                  │ server = k0sec     │
                  │                    │
                  │ presence           │
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

D1: identidade, autorização e outros dados persistentes.
```

## Planos

- **Persistent plane:** D1 guarda contas, hashes de credenciais, sessões, convites, canais e eventos técnicos mínimos. Presença, call, speaking e mídia ativa não produzem writes no D1.
- **Control plane:** o Worker autentica e autoriza a conexão. Um `ServerRealtime` por `serverId` mantém presença, conexões, participantes, call leases, estado de mute/deafen e o registro efêmero de publicações. O navegador mantém um WebSocket hibernável por servidor visualizado.
- **Media plane:** o navegador negocia uma única `RTCPeerConnection` com o Cloudflare Realtime SFU durante a call. Microfone, câmera, tela e áudio da tela usam tracks independentes na mesma sessão. Secrets e chamadas privilegiadas permanecem no Worker.

## Bootstrap e estado realtime

`GET /api/bootstrap` entrega os dados persistentes pequenos necessários para iniciar a interface: identidade, resumo do servidor, canais, membros, configuração pública e capacidades. A consulta de canais e a consulta de membros são independentes e executadas em paralelo. O endpoint não retorna credenciais, sessões, hashes, convites ou histórico de mídia.

Depois do bootstrap, o WebSocket envia um snapshot exclusivamente efêmero com usuários online, participantes da call e publicações. Mudanças usam deltas de presença, membership, call e mídia. Um reconnect solicita apenas esse snapshot; não repete o bootstrap nem consulta novamente a lista de membros.

Abrir a aplicação estabelece presença, mas não entra em um canal de voz e não cria sessão SFU. A call começa somente após `call.join` explícito pelo WebSocket. Sair envia `call.leave`, libera mídia e lease, mas preserva a mesma conexão de presença.

## ServerRealtime

O binding `SERVER_REALTIME` é nomeado pelo `serverId`. Hoje existe `k0sec`; grupos futuros podem usar uma instância independente por servidor. O objeto não armazena frames ou conteúdo de mídia.

Cada transporte possui um `connectionId` aleatório, uma sessão autenticada e um attachment hibernável. A presença é agregada por usuário: múltiplas abas ou dispositivos geram um único membro online. Uma conta mantém no máximo uma call ativa; outra conexão recebe conflito ou pode transferir o lease com `call.takeover`.

Uma queda inesperada suspende a conexão lógica por 45 segundos. A retomada autenticada exige o mesmo usuário, sessão, `connectionId` e um `connectionEpoch` maior. O estado mínimo suspenso fica no storage do Durable Object até o fim do grace period. Fechamento explícito remove imediatamente call e presença quando essa era a última conexão.

O WebSocket usa Hibernation API e não mantém heartbeat ou watchdog periódico da aplicação. Attachments reconstroem identidade e ownership após hibernação. Alarms são agendados somente para grace period ou para o limite real de validade/ociosidade da sessão. Logout, logout global, recuperação e rotação de sessão notificam o Durable Object para revogação imediata.

## Registro de publicações

O `ServerRealtime` associa cada `publicationId` opaco ao usuário, conexão, canal, sessão Realtime, track interna, `mid`, tipo e fonte. O frontend recebe apenas metadados públicos. Reservas atômicas impedem publicações e subscriptions duplicadas; falhas cancelam a reserva.

Publicações e subscriptions aceitam batches. Vídeo e áudio de uma tela compartilham uma negociação HTTP/SFU. Ao entrar, o snapshot já informa todas as publicações existentes; o cliente prioriza microfone, áudio de tela, vídeo de tela e câmera ao assinar.

## Fronteiras de segurança

O navegador recebe cookie opaco HttpOnly e token CSRF em memória. Mutações HTTP atravessam Origin, CSRF, schema, autorização e rate limit. O upgrade WebSocket valida sessão, Origin, servidor e limites antes de injetar identidade em headers internos ao Durable Object. Mensagens do cliente não aceitam `userId`, role, nomes de tracks do SFU ou secrets.

D1 continua sendo a fonte de verdade para identidade, sessão, role e canais. O `ServerRealtime` mantém somente estado efêmero autorizado. Operações SDP permanecem em HTTP porque a resposta precisa atualizar a `RTCPeerConnection` do navegador e pode ultrapassar o limite compacto do protocolo de controle.

Consulte [realtime.md](realtime.md), [connection-lifecycle.md](connection-lifecycle.md) e [realtime-request-budget.md](realtime-request-budget.md).
