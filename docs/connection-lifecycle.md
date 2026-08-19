# Ciclo de conexão e mídia

## Estado global da chamada

O estado exibido deriva de sinais independentes do WebSocket, PeerConnection, ICE, rede, visibilidade e intenção do usuário. Um transporte desconectado não implica que a mídia caiu.

```text
CONNECTED
   │
   ├── oscilação transitória
   ▼
DEGRADED
   │
   ├── recuperou ───────────────────────────────┐
   │                                            ▼
   └── grace expirou                         CONNECTED
           │                                    ▲
           ▼                                    │
      RECONNECTING                              │
           │                                    │
           ├── recuperou ───────────────────────┘
           │
           └── sessão precisa de rebuild
                    │
                    ▼
                RECOVERING
                    │
                    ├── sucesso ────────────────► CONNECTED
                    └── falha prolongada ───────► FAILED
```

`FAILED` representa falha prolongada, não abandono. O backoff continua limitado a 30 segundos. Um disconnect solicitado pelo usuário muda para `DISCONNECTING`, cancela timers e invalida a geração antes do cleanup; o estado final é `DISCONNECTED`.

## Ordem de recovery

```text
sinal de falha
  → deduplicar no supervisor
  → aguardar grace quando a falha é transitória
  → validar rede e retomar WebSocket
  → aplicar server.ready autoritativo
  → verificar PeerConnection + ICE + tracks desejadas
  → manter sessão saudável ou reconstruir sessão SFU
  → republicar mídia ainda desejada
  → reassinar publicações remotas
```

Gerações impedem callbacks de sockets, sessões e operações antigas de alterar o estado atual. Sinais simultâneos apenas marcam uma reconciliação pendente. Eventos do WebSocket, PeerConnection, ICE, rede e lifecycle acionam a reconciliação; não existe watchdog periódico.

## Tela

```text
ACTIVE
 │
 ├── user_stop ─────────► STOPPING ─────────► IDLE
 │
 ├── track_ended ───────────────────────────► IDLE
 │
 └── perda transitória ─► RECOVERING
                              │
                              ├── track viva ─► ACTIVE
                              └── track ended ► IDLE
```

Stop é idempotente entre clique, `track.onended` e resposta de rede. A intenção muda para off e a UI local é removida antes da chamada de controle. O servidor publica o unpublish de vídeo e áudio antes de fechar tracks no SFU. Uma tela terminada nunca chama `getDisplayMedia()` durante recovery.

## Troca de câmera

```text
OLD CAMERA ACTIVE
        │
        ▼
ACQUIRE NEW CAMERA
        │
        ▼
VALIDATE NEW TRACK
        │
        ▼
REPLACE SENDER TRACK
        │
        ▼
STOP OLD CAMERA
```

Qualquer falha anterior à substituição encerra apenas a nova captura e mantém a câmera antiga. A operação usa `deviceId` exato quando disponível e `facingMode` ideal como fallback. Um generation ID ignora conclusão atrasada; o busy guard impede trocas concorrentes. A publicação e a sessão Realtime permanecem as mesmas, e o microfone não participa da troca.

## Background e limites da plataforma

O aplicativo não encerra áudio, câmera, tela ou WebSocket ao ocultar a página. Ao receber `visibilitychange` para visible, `pageshow`, `resume` ou `online`, o supervisor reconcilia imediatamente sem polling.

Navegadores e sistemas operacionais podem suspender JavaScript, rede, microfone, câmera ou captura de tela. O aplicativo não consegue impedir essa decisão. Após a execução voltar, ele detecta estado obsoleto e converge para a intenção possível; permissões revogadas e screen share encerrado exigem nova ação explícita do usuário.

## Privacidade

RTT, jitter, perda, bytes e informações do candidate pair permanecem transitórios e locais no painel de desenvolvimento. O ciclo de recovery não cria analytics, histórico de rede ou rastreamento de atividade em background.
