# Clientes nativos

## Composição

Os clientes instalados usam Tauri 2, Rust e os assets React produzidos localmente. O WebView não navega para o site público. O React compartilha tipos, autenticação, estado social, realtime e WebRTC, enquanto cada plataforma escolhe uma composição própria:

- `src/ui/desktop`: entrada e composição desktop;
- `src/ui/mobile`: entrada e composição Android;
- `src/ui/native`: startup, offline, sessão e lifecycle compartilhados pelos clientes instalados;
- `src/ui/shared`: componentes visuais reutilizáveis;
- `src/core`: transporte, plataforma, deep links, notificações e preferências;
- `src-tauri`: janela, tray, cofre de sessão, HTTP, WebSocket e integração do sistema.

O desktop usa painéis simultâneos e ocupa toda a janela. O Android usa navegação hierárquica, conteúdo em tela inteira e navegação inferior para conversas, amigos, chamadas e perfil. As duas composições reutilizam os tokens de `src/styles/tokens.css`.

## Inicialização e sessão

```text
assets locais
    |
    v
verificação de atualização desktop
    |
    v
bootstrap autenticado
    |-------------------|
    v                   v
login dedicado      aplicação
    |
    v
backend oficial
```

O shell mostra startup, login, bootstrap, offline e erros com estados locais. Uma sessão válida abre a aplicação diretamente. Falhas de rede preservam uma ação de nova tentativa. Uma resposta `AUTH_REQUIRED` durante o uso abre o diálogo de sessão expirada antes de retornar ao login.

O bridge Rust mantém um cookie jar restrito a `https://connect.k0sec.org`. O token opaco da sessão fica no cofre nativo e não é serializado pelo IPC. CSRF continua rotacionado pelo backend e armazenado somente na memória do React. Logout atravessa o endpoint oficial, revoga a sessão e limpa o estado apropriado do cliente.

## Realtime

O bridge WebSocket Rust conecta somente a `wss://connect.k0sec.org/api/servers/*/socket`, inclui a sessão e informa a origem oficial. A interface usa o mesmo supervisor, `connectionId`, `connectionEpoch`, snapshots e deltas do cliente web. Quedas de transporte acionam o estado existente de reconexão e não criam outra máquina de lifecycle.

Uma entrada inicial que não consegue publicar mídia retorna ao estado inativo e libera o canal no servidor. Recovery é reservado para uma chamada que já iniciou e é limitado a seis tentativas com backoff; ao atingir o limite, a interface informa a falha e aguarda uma nova ação do usuário.

## Mídia e permissões

Microfone é solicitado ao entrar em voz e câmera ao ativar o respectivo controle. Compartilhamento de tela abre o seletor seguro da plataforma a cada compartilhamento. O aplicativo não salva nem contorna decisões de privacidade do sistema operacional.

No Linux, o WebKitGTK recebe explicitamente a habilitação de mídia e o manipulador restrito a requisições de áudio e vídeo. O microfone usa a associação padrão de track, enquanto câmera e tela usam transceivers explícitas. A publicação usa o `mid` da transceiver, o identificador equivalente da offer SDP ou a seção de mídia correspondente, conforme a disponibilidade da implementação WebRTC. Os pacotes RPM incluem dependências de PipeWire e libnice; os pacotes Debian declaram os equivalentes. O AppImage reúne as dependências de mídia distribuídas com o aplicativo.

Para desenvolvimento no Fedora, instale o elemento WebRTC do GStreamer com `sudo dnf install -y libnice-gstreamer1`.

Se o WebKit relatar falha ao abrir o remote do PipeWire, confirme os serviços da sessão com `systemctl --user status pipewire pipewire-pulse wireplumber`. Para restaurar a sessão de mídia, execute `systemctl --user restart wireplumber pipewire pipewire-pulse`, aguarde os três serviços ficarem ativos e reinicie o cliente.

## Integrações do sistema

No desktop, fechar a janela envia o aplicativo para o tray. O menu oferece abertura, estado, silenciamento de notificações, configurações, atualização e saída. A saída explícita encerra o processo.

Notificações aparecem somente com permissão do sistema, com o aplicativo em segundo plano e com a preferência habilitada. O conteúdo da mensagem é oculto por padrão. Clicar em uma notificação foca a janela e seleciona a conversa identificada pelo metadado opaco recebido.

Deep links aceitos:

- `k0nnect://invite/<token>`;
- `k0nnect://dm/<conversationId>`.

Tokens e identificadores são validados antes de alterar a rota. Uma segunda abertura foca a instância existente no desktop. Links HTTPS do domínio oficial exigem a associação de aplicativo do sistema operacional e os arquivos de verificação do domínio antes da publicação.

## Atualizações

O updater Tauri é exclusivo do desktop e verifica, baixa, instala e reinicia sem abrir navegador. A interface informa verificação, progresso em megabytes, instalação, reinício e falha recuperável. A verificação automática é habilitada no build com:

```bash
VITE_K0NNECT_UPDATER_ENABLED=true pnpm desktop:build
```

O build de release precisa configurar `plugins.updater.endpoints` e `plugins.updater.pubkey` em `src-tauri/tauri.conf.json` ou em um arquivo de configuração mesclado. A chave pública pode ser versionada; a chave privada de assinatura fica somente no secret store da CI. O manifesto publicado deve referenciar artefatos assinados gerados por `bundle.createUpdaterArtifacts`.

Android recebe atualizações pelo canal de distribuição da loja. O updater desktop não é incluído na capability mobile.

## Build local

Requisitos: Node.js 22+, pnpm 11, Rust 1.90+ pelo rustup, dependências nativas do Tauri e, para Android, Android Studio/SDK/NDK e alvos Rust Android.

```bash
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:build
pnpm android:init
pnpm android:dev
pnpm android:build
```

`pnpm desktop:dev` inicia o Vite em `127.0.0.1:5174` e abre a janela Tauri. Mantenha o comando em execução durante o desenvolvimento; `Ctrl+C` encerra o servidor e o aplicativo.

`pnpm tauri info` lista os pré-requisitos detectados. Antes de uma release, valide login, restauração e revogação de sessão, deep links com o processo aberto e fechado, tray, notificações, permissões, updater assinado, áudio, câmera, troca de dispositivo, compartilhamento de tela, suspensão e reconexão em dispositivos reais.

## Segurança de release

- não coloque senha, token de sessão, chave privada, Turnstile secret ou credencial Cloudflare em arquivos do aplicativo;
- assine instaladores e atualizações na CI protegida;
- restrinja a publicação de artefatos a tags revisadas;
- revise capabilities Tauri e permissões Android a cada plugin;
- teste a política CSP empacotada;
- publique associações HTTPS somente sob `connect.k0sec.org`;
- mantenha logs sem conteúdo de mensagens, tokens ou mídia.
