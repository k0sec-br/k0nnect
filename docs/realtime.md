# Realtime e voz

## Presença

Cada sala usa um Durable Object `VoiceRoom`. O endpoint WebSocket exige sessão, Origin exata, sala existente e rate limit antes do upgrade. A identidade vem da sessão; conexões duplicadas do mesmo usuário substituem a anterior. Attachments serializados permitem WebSocket Hibernation sem manter estado global mutável.

O protocolo versionado (`v: 1`) aceita apenas heartbeat, mute/deafen e speaking. Payloads são validados por Zod, têm limite de 4 KiB e orçamento de 50 mensagens por 10 segundos. Três mensagens inválidas encerram a conexão. Deafen implica mute no servidor; clientes não enviam `userId`.

## Mídia

O navegador solicita TURN, cria uma sessão SFU, publica uma trilha de áudio e assina trilhas anunciadas por outros participantes. Cada operação é autenticada, protegida por CSRF/rate limit e verificada contra a conexão e a propriedade da sessão no Durable Object. O Worker chama a API Realtime com secrets; nenhum secret chega ao bundle.

Áudio não atravessa o Durable Object, não entra no D1 e não é gravado. Credenciais TURN têm duração curta. Mute desabilita a trilha local; deafen também silencia os elementos remotos. Speaking usa Web Audio local e envia somente transições limitadas.

## Falhas e reconexão

WebSocket usa backoff exponencial com jitter e tenta novamente ao voltar online. Uma conexão WebRTC falha é encerrada e recriada até cinco vezes com backoff. Permissão negada, ausência de microfone, dispositivo ocupado e falha de rede são convertidos em mensagens humanas.

Localmente, `REALTIME_ENABLED=false` mantém presença disponível e impede áudio. O adapter local nunca publica mídia e não é ativado em produção silenciosamente.
