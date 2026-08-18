# Arquitetura

```text
                      connect.k0sec.org
                              │
                    Cloudflare Worker
                     /               \
              Static Assets           API (Hono)
               React/Vite                 │
                         ┌────────────────┼───────────────────┐
                         │                │                   │
                        D1         Durable Objects      Realtime API
                         │           VoiceRoom                 │
                    estado durável    WebSockets          autorização
                                                              │
Browser ─────────────────────── WebRTC ───────── Cloudflare Realtime SFU
```

## Planos

- **Control plane:** Worker + Durable Objects. A API autentica, autoriza e emite operações de mídia; `VoiceRoom` mantém presença efêmera e identidade autoritativa via WebSocket hibernável; `SecurityGate` limita abuso por identificadores com hash.
- **Persistent plane:** D1 guarda contas, hashes de credenciais, sessões, convites, salas e eventos técnicos mínimos. Operações sensíveis usam statements parametrizados e batches condicionais.
- **Media plane:** o navegador negocia WebRTC com o Cloudflare Realtime SFU. Secrets e chamadas privilegiadas permanecem no Worker. TURN usa credenciais de curta duração.

## Fronteiras e fluxo

O navegador recebe apenas dados públicos, cookie opaco HttpOnly e token CSRF mantido em memória. Mutações atravessam Origin, CSRF, schema e autorização. O Worker deriva a identidade da sessão e injeta cabeçalhos internos ao Durable Object; mensagens do cliente não aceitam `userId` ou role.

D1 é a fonte de verdade para identidade e autorização. Estado de sala é efêmero e reconstruído das conexões ativas. A perda do Durable Object não perde credenciais. A perda de conexão provoca backoff exponencial no WebSocket e recriação limitada da sessão WebRTC.

## Extensão

`ManagedMediaTrack` separa `AudioTrack`, `VideoTrack` e `ScreenTrack`, mas somente áudio está implementado. O modelo de sala aceita os tipos futuros `voice` e `text`, enquanto a API lista apenas voz na v0.1.
