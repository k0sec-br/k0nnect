# Orçamento de requests realtime

Este documento registra o custo lógico do control plane e os limites esperados em estado estável. Os números contam operações da aplicação, não pacotes WebRTC, tráfego interno da plataforma ou ping/pong automático do protocolo WebSocket.

Uma leitura de sessão representa uma query D1 com join entre sessão e usuário. O touch de `last_seen_at` ocorre no máximo a cada cinco minutos; por isso os writes condicionais aparecem como `1–2` no bootstrap. Queries de canais e membros são únicas, sem N+1.

## Auditoria antes e depois

| Fluxo                        | Versão | HTTP | WS upgrades |             WS messages | Worker |         DO | D1 reads | D1 writes | Realtime calls |
| ---------------------------- | ------ | ---: | ----------: | ----------------------: | -----: | ---------: | -------: | --------: | -------------: |
| Abrir k0nnect                | Antes  |    3 |           1 |                       1 |      4 |         ~7 |        5 |       1–2 |              0 |
| Abrir k0nnect                | Depois |    1 |           1 |                       1 |      2 |         ~4 |        4 |       1–2 |              0 |
| Entrar em Geral, voz         | Antes  |    3 |           0 |                       0 |      3 |        ~19 |        6 |         0 |              3 |
| Entrar em Geral, voz         | Depois |    2 |           0 |                       2 |      2 |        ~11 |        3 |         0 |              3 |
| Sair de Geral, voz           | Antes  |    1 |           0 |                       1 |      1 |         ~9 |        2 |         0 |              1 |
| Sair de Geral, voz           | Depois |    0 |           0 |                       1 |      0 |          1 |        0 |         0 |   1 assíncrona |
| Ligar câmera                 | Antes  |    1 |           0 |              1 derivada |      1 |         ~8 |        2 |         0 |              1 |
| Ligar câmera                 | Depois |    1 |           0 |              1 derivada |      1 |         ~6 |        1 |         0 |              1 |
| Desligar câmera              | Antes  |    1 |           0 |              1 derivada |      1 |         ~9 |        2 |         0 |              1 |
| Desligar câmera              | Depois |    1 |           0 |              1 derivada |      1 |         ~7 |        1 |         0 |              1 |
| Iniciar tela com áudio       | Antes  |    2 |           0 |             2 derivadas |      2 |        ~16 |        4 |         0 |              2 |
| Iniciar tela com áudio       | Depois |    1 |           0 | 2 deltas no mesmo batch |      1 |         ~6 |        1 |         0 |              1 |
| Parar tela com áudio         | Antes  |    1 |           0 |             2 derivadas |      1 |        ~10 |        2 |         0 |            1–2 |
| Parar tela com áudio         | Depois |    1 |           0 | 2 deltas no mesmo batch |      1 |         ~8 |        1 |         0 |              1 |
| Online explícito             | Antes  |    0 |           1 |                       1 |      1 |         ~4 |        3 |         0 |              0 |
| Online explícito             | Depois |    0 |           1 |                       1 |      1 |         ~3 |        1 |         0 |              0 |
| Offline explícito            | Antes  |    0 |           0 |                       1 |      0 |          1 |        0 |         0 |        cleanup |
| Offline explícito            | Depois |    0 |           0 |                 1 delta |      0 |          1 |        0 |         0 |        cleanup |
| Abrir Settings com app ativo | Antes  |    0 |           0 |                       0 |      0 |          0 |        0 |         0 |              0 |
| Abrir Settings com app ativo | Depois |    0 |           0 |                       0 |      0 |          0 |        0 |         0 |              0 |
| Reconnect do control plane   | Antes  |    0 |           1 |              1 snapshot |      1 |         ~4 |        3 |         0 |              0 |
| Reconnect do control plane   | Depois |    0 |           1 |              1 snapshot |      1 |         ~3 |        1 |         0 |              0 |
| Idle por 10 minutos          | Antes  |    0 |           0 |       ~48 heartbeat/ack |      0 | ~10 alarms |      ~10 |         0 |              0 |
| Idle por 10 minutos          | Depois |    0 |           0 |                       0 |      0 |   0 normal |        0 |         0 |              0 |

Os totais de DO são aproximações de chamadas lógicas e incluem rate limiting dedicado. Broadcasts contam como mensagens entregues a cada cliente afetado. Cleanup Realtime depende da quantidade de tracks existentes; o endpoint do SFU aceita o fechamento do grupo em uma operação.

Os 2 HTTPs de entrada na call são necessários: criação de sessão + TURN e publicação do microfone. O `call.join` e seu snapshot usam o WebSocket. Operações SDP de câmera e tela permanecem em HTTP porque o navegador precisa aplicar a resposta SDP; duplicá-las no WebSocket aumentaria chatter e poderia divergir o estado da PeerConnection.

## Orçamento alvo

### App open

```text
HTTP:             1 bootstrap
WebSocket:        1 upgrade
Snapshot:         1 mensagem
D1:               sessão + canais + membros
Realtime SFU:     0
```

### Idle online por uma hora

```text
HTTP:             0
Polling:          0
WS da aplicação:  0
D1 reads:         0 em estado normal
D1 writes:        0
Realtime SFU:     0 fora de call
```

Um alarm pode ocorrer no limite real de expiração/ociosidade da sessão ou no fim de um grace period de reconnect. Não existe varredura por minuto.

### Join de call

```text
WebSocket:        1 comando + 1 resposta com snapshot
HTTP:             2 para voz inicial
Realtime SFU:     sessão + TURN em paralelo, depois publicação do microfone
D1:               1 autorização de canal + 2 leituras de sessão HTTP
```

### Leave de call

```text
WebSocket:        1 comando
HTTP:             0
D1:               0
Realtime SFU:     1 cleanup assíncrono em batch
Presence socket:  permanece aberto
```

### Presence update

```text
HTTP:             0
D1:               0
WebSocket:        1 delta por mudança efetiva
```

### Call estável por dez minutos

```text
HTTP control:     0
WS da aplicação:  0, salvo mudança real de mute/deafen/speaking
D1:               0
Mídia:            WebRTC/SFU
```

Speaking envia somente transições booleanas com debounce; não transmite volume. Mute, deafen, câmera e tela enviam estado apenas quando ele muda.

## Instrumentação de desenvolvimento

Em DEV, o frontend expõe:

```js
window.__k0nnectDevelopmentMetrics.snapshot();
window.__k0nnectDevelopmentMetrics.reset();
```

Os contadores são `httpRequests`, `realtimeApiCalls`, `wsMessagesSent`, `wsMessagesReceived` e `wsReconnects`. Eles permanecem locais e não são compilados como analytics de produção.

## Limites e evolução

- Cada aba mantém uma conexão própria. SharedWorker ou eleição entre abas só deve ser considerada depois de medir uso real.
- Um servidor visualizado mantém um `ServerRealtime`; clientes não devem abrir sockets para servidores que não estão em uso.
- A instância pode ser particionada por servidor ou shard quando volume real justificar. O desenho atual evita um Durable Object por usuário.
- Sessão e autorização continuam sendo consultadas nos limites de segurança. Remover essas leituras para atingir um número menor não faz parte do orçamento.
