# Política de segurança

## Versões suportadas

Enquanto o projeto estiver na linha 0.x, somente a versão mais recente da branch `develop` recebe correções.

## Reportando uma vulnerabilidade

Não publique exploits, tokens, dados de usuários ou detalhes de uma vulnerabilidade em issues ou pull requests. Use o recurso **Private vulnerability reporting** do repositório GitHub. Se ele estiver indisponível, contate os mantenedores por um canal privado indicado no perfil da organização k0sec-br.

Inclua impacto, pré-condições, versão/commit afetado, reprodução mínima e mitigação sugerida. Não acesse dados de terceiros, não degrade o serviço e não faça engenharia social. A equipe deve confirmar o recebimento, avaliar severidade e coordenar correção/divulgação; prazos dependem do impacto e da disponibilidade do projeto comunitário.

## Escopo de segurança

Autenticação, recovery codes, convites, sessões, autorização, Durable Objects, WebSocket, integração Realtime e configuração de deploy estão no escopo. Segredos de conta Cloudflare, configuração incorreta de uma instalação de terceiros e vulnerabilidades já públicas sem impacto específico devem ser tratados pelo operador correspondente.

Controles implementados são descritos em [docs/security-controls.md](docs/security-controls.md); limites e riscos residuais estão em [docs/threat-model.md](docs/threat-model.md).
