# Autenticação

## Convite e cadastro

Convites são tokens aleatórios de 256 bits. O servidor armazena somente SHA-256; o link usa `/invite#token`, de modo que o fragmento não participa da requisição HTTP. O frontend captura o valor uma vez em memória e limpa a URL. Cadastro e consumo são condicionais no mesmo batch D1, impedindo replay concorrente. A primeira tentativa estruturalmente válida encerra o convite; uma colisão de username o revoga para impedir enumeração repetida.

O primeiro owner é criado somente por CLI após a migration:

```bash
pnpm invite:create -- --role owner
# produção, depois de autenticar o Wrangler:
pnpm invite:create -- --role owner --remote
```

Depois disso, owner cria convites de member/admin; admin cria apenas member; member não cria convites.

## Senhas e recuperação

Senhas têm 12–128 caracteres e não são normalizadas. O hash é PBKDF2-HMAC-SHA-256 com salt aleatório de 128 bits, pepper secreto, 100.000 iterações e saída de 256 bits. Comparações usam operação constante fornecida pelo runtime. Contas inexistentes executam derivação falsa antes da resposta genérica.

No cadastro são gerados dez códigos de recuperação com 160 bits legíveis cada. Somente hashes são persistidos. Um código válido troca a senha, revoga sessões, consome o código atomicamente e emite um conjunto novo. Regeneração autenticada confirma a senha e rotaciona a sessão.

## Sessões

O navegador recebe `__Host-k0nnect_session`, com `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` e sem `Domain`. D1 guarda apenas o hash. A sessão expira após sete dias ociosa ou trinta dias absolutos; `last_seen_at` é atualizado no máximo a cada cinco minutos.

Login rotaciona a sessão atual. Logout revoga uma; logout-all revoga todas. Contas disabled não autenticam. WebSockets abertos revalidam a sessão a cada minuto. O token CSRF é independente, rotacionado na leitura da sessão e mantido somente em memória pelo frontend.

## Antiabuso

Limites combinam IP e conta/usuário em `SecurityGate`, sem usar IP bruto como nome do Durable Object. Falhas acionam Turnstile adaptativo a partir do limiar configurado. Uma senha correta zera o contador de falhas da conta. O sistema não bloqueia indefinidamente uma conta por tentativas de terceiros.
