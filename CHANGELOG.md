# Changelog

Todas as mudanças relevantes serão documentadas neste arquivo, seguindo Keep a Changelog e versionamento semântico quando a API estabilizar.

## [Unreleased]

### Added

- Fundação da v0.1 com cadastro por convite, sessões seguras e recovery codes.
- Sala Geral com presença por Durable Object e áudio via Cloudflare Realtime.
- Painel de convites, páginas de privacidade/segurança, testes e CI.
- Câmera, seleção de dispositivos, prévia local e grade responsiva.
- Compartilhamento de tela com áudio opcional, palco, miniaturas e tela cheia.
- Diagnóstico WebRTC local disponível apenas no ambiente de desenvolvimento.
- Supervisor de conexão com state machine, recovery deduplicado e reconciliação após retomada.
- Retomada autenticada de WebSocket com identidade lógica, epoch e grace period server-side.
- Razões autoritativas para encerramento de mídia e diagnóstico local de lifecycle/recovery.
- Amizades por username exato, solicitações pendentes e mensagens diretas criadas no primeiro envio.
- Grupos privados de até 20 membros com chat, chamada, transferência de owner e remoção imediata de acesso.
- Chat persistente de texto simples com cursor, idempotência, edição do remetente e exclusão lógica.

### Changed

- Protocolo de sala v3 com heartbeat adaptativo, identificação de retomada e eventos de unpublish com motivo.
- Uma sessão WebRTC por participante multiplexa microfone, câmera e tela com negociações serializadas.
- Política de permissões libera microfone, câmera e captura de tela somente para a própria origem.
- Troca de câmera é transacional, preserva a track anterior em falhas e mantém o microfone intacto.
- Encerramento de tela remove a UI imediatamente, agrupa áudio/vídeo e preserva a chamada.
- Protocolo realtime v5 compartilha um WebSocket entre presença, chat e controle de chamada.

[Unreleased]: https://github.com/k0sec-br/k0nnect/compare/main...develop
