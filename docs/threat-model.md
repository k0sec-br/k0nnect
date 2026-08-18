# Threat model

## Ativos e adversários

Ativos: contas, roles, convites, recovery codes, sessões, presença, áudio em trânsito e secrets Cloudflare. Consideramos atacantes anônimos, usuário member malicioso, conta admin comprometida, site externo tentando CSRF/WebSocket hijacking e observador de rede. Comprometimento total da conta Cloudflare ou do dispositivo do usuário permanece fora da capacidade da aplicação.

## Fronteiras de confiança

Browser é não confiável. Worker é a fronteira de autenticação/autorização. D1 é persistente; Durable Objects recebem identidade somente do Worker; APIs Realtime/TURN são serviços externos privilegiados. Toda passagem valida forma, identidade, finalidade e tamanho.

## Ameaças principais

- **Enumeração/brute force:** mensagens genéricas, derivação dummy, rate limits combinados e Turnstile. Convite com colisão de username é encerrado para impedir tentativas repetidas. Risco residual: ataques distribuídos e custo de PBKDF2; monitorar taxas agregadas.
- **Replay/races:** tokens de alto entropy, hashes e updates condicionais serializados pelo D1. Risco residual: quem obtiver um convite bruto antes do uso pode consumi-lo.
- **Sessão/CSRF:** cookie host-only HttpOnly, rotação, expiração ociosa/absoluta, Origin e CSRF. XSS no mesmo origin ainda pode operar a sessão; CSP e renderização segura reduzem o risco.
- **Escalada/IDOR:** role e userId nunca vêm do cliente; autorização por recurso no servidor. Admin comprometido ainda pode criar/revogar convites permitidos.
- **WebSocket/DoS:** limites antes e depois do upgrade, payload máximo, conexão única por usuário e revalidação de sessão a cada minuto. Ataques volumétricos de camada de rede dependem das proteções Cloudflare.
- **Privacidade de mídia:** SFU/TURN evita portas residenciais e não persiste áudio. O provedor de infraestrutura necessariamente processa pacotes e IPs; WebRTC não oferece E2EE de aplicação nesta versão.
- **Revogação de mídia:** o Durable Object fecha WebSocket e tracks conhecidas após desconexão ou revalidação. O fechamento no SFU é best-effort e pode levar até um minuto após uma revogação server-side.
- **Supply chain/deploy:** lockfile, Dependabot, audit e CI sem secrets em PR. Operador ainda deve proteger conta, tokens, branch e ambiente de produção.

## Revisão

Reavalie este documento em mudanças de autenticação, novos tipos de mídia, mensagens persistentes, cadastro público, federação ou analytics. Cadastro público exige política antiabuso própria e não deve ser habilitado apenas mudando a flag existente.
