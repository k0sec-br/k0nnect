# Realtime, voz e vídeo

## Presença e protocolo

Cada servidor usa um Durable Object `ServerRealtime`. O endpoint `/api/servers/:serverId/socket` exige sessão válida, Origin exata, servidor conhecido e rate limit antes do upgrade. A identidade é derivada da sessão autenticada e nunca do payload do cliente.

O protocolo versionado (`v: 4`) usa um WebSocket para presença e controle de call. `server.ready` entrega identidade da conexão e snapshot efêmero. Depois dele, eventos pequenos anunciam apenas deltas. Payloads são validados por Zod, limitados a 4 KiB e sujeitos a orçamento de 50 mensagens por 10 segundos.

O protocolo não usa heartbeat da aplicação, polling ou reenvio periódico de estado. A Hibernation API acompanha o lifecycle do transporte. `state.resync` permite solicitar um snapshot pelo mesmo socket quando o cliente precisa reconciliar presença, participantes e publicações.

## Presença e call são independentes

Abrir o app cria presença online. Entrar em `Geral` exige `call.join`; sair usa `call.leave` e mantém o socket aberto. A lista completa de membros vem do bootstrap e os deltas `presence.changed` alteram somente o conjunto online local.

Múltiplas conexões autenticadas da mesma conta são permitidas. A UI mostra um único membro online enquanto existir ao menos uma conexão. O `activeCallByUser` permite uma call por conta. Outra conexão recebe `call.conflict`; `call.takeover` transfere o lease, emite `call.replaced` para a anterior e responde com o snapshot da call para a nova.

## Uma sessão de mídia por participante

A sessão SFU só é criada depois do aceite de `call.join`. A mesma operação HTTP cria a sessão Realtime e obtém credenciais TURN de curta duração em paralelo. O navegador mantém uma única `RTCPeerConnection` e uma fila serializa alterações de SDP:

```text
microfone → câmera → tela → subscriptions remotas → unpublish
                         negotiation queue
```

Microfone, câmera, vídeo da tela e áudio opcional da tela usam transceivers separados. Publicação e subscription aceitam várias tracks na mesma oferta. A câmera usa três codificações simulcast conservadoras; a tela usa uma camada para preservar texto e detalhes.

Ao entrar, `call.joined` inclui participantes e publicações existentes. A UI pode sinalizar uma tela como live antes de sua track remota terminar de conectar. Subscriptions são ordenadas por microfone, áudio da tela, vídeo da tela e câmera e enviadas em batch.

## Autorização server-side

O `ServerRealtime` permite uma publicação de cada fonte por participante: `microphone`, `camera`, `screen-video` e `screen-audio`. Áudio de tela exige vídeo de tela ativo. Reservas atômicas são concluídas apenas depois da resposta válida do SFU.

O frontend envia `publicationId` opaco para assinar ou fechar mídia. O Worker valida sessão, CSRF, call lease, ownership e rate limit; o Durable Object resolve os IDs internos. Publicações próprias, de outro canal, inexistentes ou pertencentes a outra conexão são recusadas.

Operações que alteram SDP usam HTTP por correção do estado WebRTC e pelo tamanho potencial da oferta/resposta. Elas não enviam também um comando WS para representar a mesma intenção. O `ServerRealtime` produz o único delta canônico `media.published` ou `media.unpublished` aos demais clientes.

## Captura e controles

Câmera e tela começam desligadas. `getUserMedia()` e `getDisplayMedia()` são chamados somente após ação explícita. A ausência de áudio de tela é válida. O evento `ended` do vídeo encerra todo o grupo lógico de tela.

Troca de microfone ou câmera usa `RTCRtpSender.replaceTrack()` quando a fonte já está publicada. A câmera nova é adquirida e validada antes da substituição; a falha preserva câmera antiga e microfone. `devicechange` atualiza os seletores, e a remoção da webcam encerra apenas a câmera.

Ao desligar câmera ou tela, a intenção e a UI local mudam antes da operação remota. Tela fecha vídeo e áudio em um batch. O Durable Object publica `media.unpublished` antes do cleanup best-effort no SFU. Se o control plane estiver temporariamente indisponível, o reconciler retenta o fechamento sem recapturar tela ou câmera.

## Falhas e reconexão

O `ConnectionSupervisor` combina WebSocket, PeerConnection, ICE, rede, visibilidade e intenção local. Quedas confirmadas usam backoff exponencial com jitter de até 30 segundos. Uma conexão estável zera o backoff. Epochs e gerações ignoram resultados antigos e um leave solicitado cancela recovery pendente.

Uma queda do socket pode preservar WebRTC e publicações durante o grace period de 45 segundos. O reconnect usa o mesmo endpoint, retoma a conexão lógica e recebe snapshot efêmero; não repete bootstrap. Falha confirmada da PeerConnection recria a sessão SFU e republica somente microfone, câmera ainda desejada e tela cuja track continua viva. A republicação de tela continua em batch.

Nenhum timer encerra mídia por `blur`, `visibilitychange` ou `unload`. Ao voltar de suspensão, eventos de rede e lifecycle solicitam reconciliação, mas não disparam polling.

Em desenvolvimento, `MediaStatsCollector` lê `RTCPeerConnection.getStats()` localmente e `window.__k0nnectDevelopmentMetrics` expõe contadores de HTTP, operações Realtime estimadas, mensagens WS e reconnects. Esses dados não são enviados, persistidos nem habilitados em produção.

Localmente, `REALTIME_ENABLED=false` mantém o control plane disponível e impede mídia. Consulte [connection-lifecycle.md](connection-lifecycle.md) para as máquinas de estado e [manual-realtime-test.md](manual-realtime-test.md) para validação física.
