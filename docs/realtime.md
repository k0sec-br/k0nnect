# Realtime, voz e vídeo

## Presença e protocolo

Cada sala usa um Durable Object `VoiceRoom`. O endpoint WebSocket exige sessão, Origin exata, sala existente e rate limit antes do upgrade. A identidade vem da sessão; conexões duplicadas do mesmo usuário substituem a anterior. Attachments serializados permitem WebSocket Hibernation sem estado global mutável.

O protocolo versionado (`v: 3`) aceita heartbeat adaptativo, mute/deafen e speaking. `room.ready` entrega `callInstanceId`, `connectionId`, `connectionEpoch` e informa se o transporte retomou uma conexão lógica. Eventos do servidor anunciam participantes, restauração do transporte e publicações por `publicationId`. Payloads são validados por Zod, têm limite de 4 KiB e orçamento de 50 mensagens por 10 segundos. Clientes não enviam `userId`, role ou Realtime track ID. O Realtime session ID opaco volta nas operações de mídia, mas o servidor o aceita somente quando está vinculado à mesma sessão autenticada, conexão e sala.

## Uma sessão de mídia por participante

O navegador solicita TURN, cria uma sessão SFU e mantém uma única `RTCPeerConnection`. Uma fila serializa todas as alterações de SDP:

```text
microfone → câmera → tela → assinatura remota → unpublish
                         negotiation queue
```

O microfone, a câmera, o vídeo da tela e o áudio opcional da tela usam transceivers separados na mesma conexão. Câmera usa três codificações simulcast (`a`, `b`, `c`) com limites conservadores e ordem de fallback compatível com o SFU. A tela usa uma camada para preservar texto e detalhes; a arquitetura permite adicionar políticas específicas depois de testes reais.

## Autorização server-side

O Durable Object permite uma publicação de cada fonte por usuário: `microphone`, `camera`, `screen-video` e `screen-audio`. Áudio de tela exige uma publicação de tela ativa. O fluxo de publicação reserva o slot, chama o Cloudflare e conclui ou cancela a reserva.

Para assinar, o frontend envia apenas `publicationId` como identificador da mídia remota. O Worker valida autenticação, CSRF, sala, conexão, sessão e rate limit. O `VoiceRoom` reserva a assinatura atomicamente e resolve a sessão e track internas somente se a publicação pertence a outro participante conectado na mesma sala. O Worker devolve apenas SDP, `mid` local e metadados públicos.

O `VoiceRoom` revalida a sessão vinculada ao WebSocket a cada minuto. Uma queda transitória suspende a conexão por 45 segundos, preservando presença, registro de publicações e sessão de mídia. A retomada exige a mesma sessão autenticada, `callInstanceId`, `connectionId` e um epoch superior; esses identificadores coordenam a retomada e não substituem autenticação. Encerramento explícito, substituição sem retomada, revogação ou expiração do grace period removem presença e fecham as tracks conhecidas no Realtime em best effort.

## Captura e controles

Câmera e tela começam desligadas. `getUserMedia()` é chamado após ação explícita para câmera ou prévia. `getDisplayMedia()` é chamado diretamente pelo clique de compartilhar e sempre respeita o seletor do navegador. A ausência de áudio de tela é válida. O evento `ended` do vídeo da tela encerra suas publicações.

Troca de microfone ou câmera usa `RTCRtpSender.replaceTrack()` quando a fonte já está publicada. A troca de câmera adquire e valida a nova track antes de substituir a antiga; falha de `deviceId` exato pode usar `facingMode` ideal como fallback. O microfone não é recapturado nessa operação. `devicechange` atualiza os seletores; a remoção da webcam encerra somente a câmera e preserva a voz.

O encerramento de tela usa um motivo explícito (`user_stop`, `track_ended`, falha ou lifecycle). A UI local remove a tela antes da resposta da rede, e o Durable Object transmite `media.unpublished` antes do fechamento best-effort no SFU. Vídeo e áudio da tela formam um único grupo lógico. Se o plano de controle estiver indisponível, o fechamento fica pendente para o reconciler; a captura nunca é solicitada novamente sem ação do usuário.

## Falhas, reconexão e diagnóstico

Um `ConnectionSupervisor` combina saúde do WebSocket, PeerConnection, ICE, rede, visibilidade e intenção de mídia em um único loop de recovery. Oscilações `disconnected` recebem uma janela curta; falhas confirmadas reconciliam o control plane e depois a mídia. O backoff exponencial com jitter chega a 30 segundos e continua em frequência reduzida, sem tempestade de sessões. Epochs e gerações ignoram resultados atrasados, e um disconnect solicitado pelo usuário cancela recovery pendente.

WebSocket aberto e chamada saudável são estados distintos. Uma queda do socket pode manter WebRTC e tracks vivas durante o grace period. Uma falha confirmada de PeerConnection recria a sessão Realtime e republica apenas tracks ainda coerentes com a intenção do usuário: microfone, câmera ativa e tela cuja track continua viva. Tela encerrada não é recapturada.

Heartbeats usam 25 segundos em foreground e 75 segundos em background, com tolerâncias de liveness de 70 e 210 segundos. Esses timers são dicas operacionais; o servidor não considera atraso pontual como prova de abandono. `visibilitychange`, `pageshow`, `resume` e `online` solicitam reconciliação imediata ao retorno. O aplicativo não encerra mídia por `blur`, `visibilitychange` ou `unload`.

Em desenvolvimento, `MediaStatsCollector` lê `RTCPeerConnection.getStats()` localmente a cada dois segundos e exibe RTT, jitter, perdas, tráfego, FPS, codecs, bitrate estimado e caminho direto/relay. Os dados não são enviados, persistidos nem coletados em produção.

Localmente, `REALTIME_ENABLED=false` mantém presença disponível e impede mídia. O adapter local não publica mídia e não é ativado em produção silenciosamente.

Consulte [connection-lifecycle.md](connection-lifecycle.md) para as máquinas de estado e [manual-realtime-test.md](manual-realtime-test.md) para validação em navegadores e dispositivos físicos.
