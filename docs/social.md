# Modelo social

## Amizades

Amizades são pares normalizados de usuários. Uma solicitação começa como `pending`, somente o destinatário pode aceitá-la e uma recusa remove o registro. Solicitações próprias, duplicadas ou inversas são recusadas pela chave composta. Busca usa somente o username exato e retorna ID, username e nome de exibição.

Mensagens diretas exigem amizade aceita. A conversa é criada no primeiro envio com uma `pair_key` única calculada pelo servidor. Remover a amizade bloqueia novos envios, mantém o histórico e não altera grupos compartilhados.

## Grupos

K0Sec é o grupo padrão de todas as contas ativas e reutiliza `room_general` como sua call. A migration inclui usuários existentes, e o cadastro por convite inclui a associação do novo usuário no mesmo batch transacional.

Grupos privados possuem nome de 1 a 40 caracteres, um owner, até 19 outros membros, um chat e uma call. O owner só pode adicionar amigos aceitos. Ele pode renomear, adicionar, remover e transferir a propriedade. Um member pode sair; o owner transfere a propriedade antes de sair. K0Sec não pode ser renomeado, abandonado, apagado ou ter membros removidos.

`conversation_members` controla chat, histórico e call. Uma remoção marca `removed_at`, atualiza imediatamente todas as conexões do usuário e preserva a integridade referencial das mensagens antigas. Consulte [social-chat.md](social-chat.md) para o fluxo integrado.
