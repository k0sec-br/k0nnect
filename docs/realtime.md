# Realtime, voz e vídeo

## Presença e protocolo

Cada sala usa um Durable Object `VoiceRoom`. O endpoint WebSocket exige sessão, Origin exata, sala existente e rate limit antes do upgrade. A identidade vem da sessão; conexões duplicadas do mesmo usuário substituem a anterior. Attachments serializados permitem WebSocket Hibernation sem estado global mutável.

O protocolo versionado (`v: 2`) aceita heartbeat, mute/deafen e speaking. Eventos do servidor anunciam participantes e publicações por `publicationId`. Payloads são validados por Zod, têm limite de 4 KiB e orçamento de 50 mensagens por 10 segundos. Clientes não enviam `userId`, role, Realtime session ID ou Realtime track ID.

## Uma sessão de mídia por participante

O navegador solicita TURN, cria uma sessão SFU e mantém uma única `RTCPeerConnection`. Uma fila serializa todas as alterações de SDP:

```text
microfone → câmera → tela → assinatura remota → unpublish
                         negotiation queue
```

O microfone, a câmera, o vídeo da tela e o áudio opcional da tela usam transceivers separados na mesma conexão. Câmera usa três codificações simulcast (`a-high`, `b-medium`, `c-low`) com limites conservadores e ordem de fallback compatível com o SFU. A tela usa uma camada para preservar texto e detalhes; a arquitetura permite adicionar políticas específicas depois de testes reais.

## Autorização server-side

O Durable Object permite uma publicação de cada fonte por usuário: `microphone`, `camera`, `screen-video` e `screen-audio`. Áudio de tela exige uma publicação de tela ativa. O fluxo de publicação reserva o slot, chama o Cloudflare e conclui ou cancela a reserva.

Para assinar, o frontend envia apenas `publicationId`. O Worker valida autenticação, CSRF, sala, conexão, sessão e rate limit. O `VoiceRoom` resolve a sessão e track internas somente se a publicação pertence a outro participante conectado na mesma sala. O Worker devolve apenas SDP, `mid` local e metadados públicos.

## Captura e controles

Câmera e tela começam desligadas. `getUserMedia()` é chamado após ação explícita para câmera ou prévia. `getDisplayMedia()` é chamado diretamente pelo clique de compartilhar e sempre respeita o seletor do navegador. A ausência de áudio de tela é válida. O evento `ended` do vídeo da tela encerra suas publicações.

Troca de microfone ou câmera usa `RTCRtpSender.replaceTrack()` quando a fonte já está publicada. `devicechange` atualiza os seletores; a remoção da webcam encerra somente a câmera e preserva a voz.

## Falhas, reconexão e diagnóstico

WebSocket usa backoff exponencial com jitter e tenta novamente ao voltar online. Uma conexão WebRTC falha é encerrada e recriada até cinco vezes com backoff. Câmera e tela voltam desligadas após recriação para não solicitar ou capturar mídia sem nova ação do usuário.

Em desenvolvimento, `MediaStatsCollector` lê `RTCPeerConnection.getStats()` localmente a cada dois segundos e exibe RTT, jitter, perdas, tráfego, FPS, codecs, bitrate estimado e caminho direto/relay. Os dados não são enviados, persistidos nem coletados em produção.

Localmente, `REALTIME_ENABLED=false` mantém presença disponível e impede mídia. O adapter local não publica mídia e não é ativado em produção silenciosamente.
