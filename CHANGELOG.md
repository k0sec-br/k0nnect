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

### Changed

- Protocolo de sala v2 com publicações opacas autorizadas pelo Durable Object.
- Uma sessão WebRTC por participante multiplexa microfone, câmera e tela com negociações serializadas.
- Política de permissões libera microfone, câmera e captura de tela somente para a própria origem.

[Unreleased]: https://github.com/k0sec-br/k0nnect/compare/main...develop
