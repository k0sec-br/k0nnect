# Social, grupos e chat

## Modelo social

Toda conta ativa pertence ao grupo padrão K0Sec. Amizades usam um único registro por par, com os IDs ordenados e estado `pending` ou `accepted`. A busca aceita somente o username exato; sugestões, descoberta ampla e importação de contatos não fazem parte do produto.

Mensagens diretas exigem amizade aceita. A conversa DM é criada no primeiro envio, recebe ID determinístico derivado do par e permanece única sob concorrência. Desfazer a amizade bloqueia novos envios, preserva o histórico para os dois participantes e não altera grupos compartilhados.

Grupos privados possuem owner, até 19 outros membros, um chat e uma sala de chamada. Somente amigos aceitos do owner podem ser adicionados. O owner pode renomear, adicionar ou remover membros, transferir a propriedade e apagar o grupo. Um membro pode sair; o grupo padrão não pode ser renomeado, abandonado ou apagado.

## Conversas e mensagens

`conversations` unifica DMs e grupos. `conversation_members` é a fonte persistente de autorização; remoções mantêm o registro histórico com `removed_at` e tiram imediatamente o acesso ativo. Triggers D1 impedem inserts sem associação ativa e exigem amizade aceita para DMs.

Mensagens são texto simples de 1 a 2.000 caracteres. O cursor é o `id` inteiro crescente. A listagem usa `WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?`, sem `OFFSET`, com 50 itens por padrão e 100 no máximo. O bootstrap retorna somente resumos e nunca inclui o histórico.

Cada envio possui `client_message_id`. A restrição única `(sender_id, client_message_id)` transforma retries no mesmo resultado canônico. Editar e apagar exigem o mesmo `sender_id`; a exclusão é lógica, remove o conteúdo e preserva somente metadados necessários à sequência da conversa.

## Entrega realtime

Chat reutiliza o único `ServerRealtime` e o único WebSocket da aba:

```text
chat.send
    │
    ├─ capacidades do attachment
    ├─ rate limit de burst e sustentado
    ├─ INSERT D1 com idempotência
    └─ chat.message somente para membros ativos
```

Um envio comum para conversa existente faz zero leituras D1 na aplicação e um insert. Capacidades de conversa, amizade e chamada ficam no attachment hibernável e são recalculadas após toda mutação social. Remover um membro atualiza sockets ativos e conexões suspensas, encerra a call desse grupo e bloqueia eventos, histórico e novos envios.

Edição e exclusão persistem via HTTP com Origin, CSRF, sessão, schema e rate limit, e usam chamada interna ao mesmo Durable Object para entregar o delta. Histórico também usa HTTP porque é paginado, persistente e solicitado sob demanda.

## Limites do cliente

O cliente mantém no máximo cinco conversas em memória, com aproximadamente 100 mensagens por conversa. A troca de chat não troca a chamada ativa. A conta conserva um único lease global de chamada, inclusive entre abas e dispositivos.

Não existem polling, heartbeat da aplicação, WebSocket adicional, Durable Object por grupo, read receipt ou indicador de digitação.

## Índices verificados

`EXPLAIN QUERY PLAN` deve apresentar:

```text
messages:              SEARCH ... USING INDEX idx_messages_history
friendships low/high:  MULTI-INDEX OR com idx_friendships_low_status e idx_friendships_high_status
conversations by user: SEARCH ... USING INDEX idx_conversation_members_user
```

Esses planos cobrem histórico por cursor, amizades dos dois lados do par normalizado e resumos de conversas por usuário.
