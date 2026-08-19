# Chat

## Ciclo da mensagem

1. O cliente cria `client_message_id` com `crypto.randomUUID()` e mostra a mensagem como `sending`.
2. `chat.send` percorre o WebSocket de controle existente, sem HTTP.
3. `ServerRealtime` valida schema, tamanho, rate limit e capacidade do attachment.
4. Um `INSERT messages ... RETURNING` persiste a mensagem.
5. `chat.message` entrega o objeto canônico somente às conexões da conversa.
6. O sender substitui o item otimista pelo canônico. Falhas mostram retry com o mesmo `client_message_id`.

A unicidade `(sender_id, client_message_id)` torna o retry idempotente. O payload não aceita identidade do remetente. Texto possui até 2.000 caracteres, preserva Unicode, espaços e quebras de linha, e é renderizado sem interpretação HTML.

## Histórico

Histórico não integra o bootstrap. A primeira abertura solicita 50 mensagens; o cliente pode carregar outras 50 e o servidor limita cada página a 100. O cursor inteiro usa `id < ?`, nunca `OFFSET`. Cinco conversas e aproximadamente 100 mensagens por conversa permanecem em uma store volátil com eviction; cada view assina somente a conversa visível, sem propagar o ritmo do chat para o provider de mídia. Nenhuma mensagem é gravada no storage do navegador.

## Edição e exclusão

Somente o remetente com acesso ativo à conversa pode editar ou apagar. Edição atualiza conteúdo e `edited_at`. Exclusão lógica define `deleted_at` e remove o conteúdo antigo. Os deltas retornam pelo mesmo Durable Object.

## Autorização e custo

O caminho normal consulta capacidades hibernáveis e executa zero reads D1 na aplicação e um insert principal. Triggers D1 impedem inserts concorrentes sem associação ativa ou, em DMs, sem amizade aceita. O rate limit permite burst de 5 mensagens em 5 segundos e 60 por minuto. Chat ocioso não gera HTTP, polling, eventos da aplicação ou writes.

Consulte [realtime-request-budget.md](realtime-request-budget.md) para os demais fluxos e [social.md](social.md) para amizades e grupos.
