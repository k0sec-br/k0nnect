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

```text
                         VoiceRoom DO
                              │
                     publication registry
                              │
           ┌──────────────────┴──────────────────┐
           │                                     │
        Pessoa A                              Pessoa B
           │                                     │
      Realtime Session                     Realtime Session
           │                                     │
    RTCPeerConnection                      RTCPeerConnection
           │                                     │
     ┌─────┼─────┐                         ┌─────┼─────┐
     │     │     │                         │     │
    mic camera screen                     mic camera
      \    │    /                           \   /
       \   │   /                       Cloudflare Realtime SFU
```

## Planos

- **Control plane:** Worker + Durable Objects. A API autentica, autoriza e emite operações de mídia; `VoiceRoom` mantém presença efêmera e identidade autoritativa via WebSocket hibernável; `SecurityGate` limita abuso por identificadores com hash.
- **Persistent plane:** D1 guarda contas, hashes de credenciais, sessões, convites, salas e eventos técnicos mínimos. Operações sensíveis usam statements parametrizados e batches condicionais.
- **Media plane:** o navegador negocia uma `RTCPeerConnection` com o Cloudflare Realtime SFU e multiplexa microfone, câmera, tela e áudio da tela na mesma sessão. Secrets e chamadas privilegiadas permanecem no Worker. TURN usa credenciais de curta duração.

## Fronteiras e fluxo

O navegador recebe apenas dados públicos, cookie opaco HttpOnly e token CSRF mantido em memória. Mutações atravessam Origin, CSRF, schema e autorização. O Worker deriva a identidade da sessão e injeta cabeçalhos internos ao Durable Object; mensagens do cliente não aceitam `userId` ou role.

D1 é a fonte de verdade para identidade e autorização. Estado de sala e publicações são efêmeros e reconstruídos das conexões ativas. Tracks não são gravadas no D1. A perda do Durable Object não perde credenciais. A perda de conexão provoca backoff exponencial no WebSocket e recriação limitada da sessão WebRTC.

## Registro de publicações

O `VoiceRoom` associa cada `publicationId` opaco ao usuário, conexão, sessão Realtime, track interna, `mid`, tipo e fonte. O frontend só recebe os campos públicos. Reservas atômicas impedem publicações duplicadas; falhas cancelam a reserva. Assinaturas resolvem o ID no Durable Object e recusam publicações próprias, inexistentes ou de outra sala.
