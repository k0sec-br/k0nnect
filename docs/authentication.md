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

No cliente Tauri, requisições de autenticação passam pelo bridge Rust com origem fixa em `https://connect.k0sec.org`. O cookie é consumido pelo cookie jar nativo e seu token opaco é persistido no gerenciador de credenciais do sistema; no Android, o armazenamento usa preferências criptografadas por uma chave do Android Keystore. O WebView não recebe o header `Set-Cookie`, o token da sessão ou acesso ao cofre. O bridge aceita somente `GET`, `POST` e `DELETE` em caminhos `/api/` da origem oficial.

Login rotaciona a sessão atual. Logout revoga uma; logout-all revoga todas. Contas disabled não autenticam. O `ServerRealtime` recebe revogações por evento e revalida cada WebSocket no limite real de validade ou ociosidade da sessão. O token CSRF é independente, rotacionado no bootstrap autenticado e mantido somente em memória pelo frontend.

Turnstile em WebView nativa é carregado por uma página mínima em `connect.k0sec.org/native/turnstile`. A página aceita apenas ações de autenticação conhecidas, valida a origem Tauri de destino e envia somente o token efêmero para a interface. A secret key continua exclusiva do Worker.

## Antiabuso

Limites combinam IP e conta/usuário em `SecurityGate`, sem usar IP bruto como nome do Durable Object. Falhas acionam Turnstile adaptativo a partir do limiar configurado. Uma senha correta zera o contador de falhas da conta. O sistema não bloqueia indefinidamente uma conta por tentativas de terceiros.
