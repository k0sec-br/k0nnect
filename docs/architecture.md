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

D1 é a fonte de verdade para identidade e autorização. Estado de sala e publicações são efêmeros; attachments hibernáveis e registros temporários no storage do Durable Object preservam a conexão lógica durante o grace period. Tracks não são gravadas no D1. A perda do Durable Object não perde credenciais. O `ConnectionSupervisor` separa saúde do control plane e do media plane, serializa recovery e reconcilia o estado real com a intenção local.

## Registro de publicações

O `VoiceRoom` associa cada `publicationId` opaco ao usuário, conexão, sessão Realtime, track interna, `mid`, tipo e fonte. O frontend só recebe os campos públicos. Reservas atômicas impedem publicações duplicadas; falhas cancelam a reserva. Assinaturas resolvem o ID no Durable Object e recusam publicações próprias, inexistentes ou de outra sala.

## Ciclo de conexão

Cada entrada na sala recebe um `callInstanceId` aleatório e um `connectionId` aleatório. Reconexões autenticadas apresentam esses identificadores com um `connectionEpoch` crescente. O Durable Object valida usuário, sessão, sala, IDs e epoch antes de transferir o attachment para o novo transporte. Uma conexão antiga marcada como superseded não executa cleanup sobre a geração atual.

O frontend mantém um único supervisor, um único recovery ativo e uma fila única de negociação WebRTC. O supervisor recupera primeiro o WebSocket e a visão autoritativa da sala. Se a PeerConnection está saudável, a sessão SFU permanece. Se ICE ou PeerConnection falham, o cliente fecha localmente a geração antiga, cria uma sessão SFU e republica somente mídia cuja intenção permanece ativa.
