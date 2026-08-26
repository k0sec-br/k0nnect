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

Microfone é solicitado ao entrar em voz e câmera ao ativar o respectivo controle. No primeiro uso de cada recurso, o cliente instalado apresenta um diálogo do k0nnect explicando a finalidade da captura. A confirmação é lembrada localmente para evitar explicações repetidas; a autorização efetiva continua sob controle do sistema operacional.

No Windows e no Linux, o host autoriza internamente pedidos de microfone e câmera feitos pela origem local do aplicativo. Essa autorização não é concedida ao site público nem a conteúdo remoto. No Android, o diálogo do k0nnect antecede a permissão de runtime obrigatória do sistema. Depois de concedida, a decisão persiste conforme as regras do Android e pode ser revogada nas configurações do aparelho.

Compartilhamento de tela abre o seletor seguro da plataforma a cada nova captura. A escolha da tela ou janela e os indicadores de captura permanecem sob controle do sistema; o aplicativo não seleciona uma fonte silenciosamente, não usa privilégios de administrador e não contorna decisões de privacidade.

No Linux, o WebKitGTK habilita explicitamente WebRTC e captura de mídia antes de recarregar o contexto da aplicação, além de usar um manipulador restrito a requisições de áudio e vídeo. O microfone usa a associação padrão de track, enquanto câmera e tela usam transceivers explícitas. A publicação usa o `mid` da transceiver, o identificador equivalente da offer SDP ou a seção de mídia correspondente, conforme a disponibilidade da implementação WebRTC.

A distribuição Linux precisa fornecer WebKitGTK compilado com `ENABLE_WEB_RTC=ON`, além dos plugins GStreamer, PipeWire e ICE exigidos pela implementação. A configuração `enable-webrtc` do aplicativo ativa uma implementação presente no WebKitGTK, mas não adiciona uma implementação ausente no pacote do sistema. O cliente verifica `RTCPeerConnection` antes de entrar no canal e mantém a chamada inativa quando esse requisito não está disponível.

Para desenvolvimento em uma distribuição com WebRTC habilitado no WebKitGTK, confirme também a presença do elemento ICE com `gst-inspect-1.0 nice`.

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

No Fedora, a compilação cruzada do instalador NSIS para Windows usa `cargo-xwin`. O script local omite assinatura de código e artefatos assinados do updater:

```bash
pnpm desktop:build:windows:local
```

O executável fica em `src-tauri/target/x86_64-pc-windows-msvc/release/k0nnect.exe`. O instalador local sem assinatura fica em `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Builds públicas configuram a chave privada do updater somente no ambiente protegido da CI, preservam `bundle.createUpdaterArtifacts` e omitem `--no-sign`.

O projeto Android fixa Java 21 para o daemon em `src-tauri/gen/android/gradle/gradle-daemon-jvm.properties`. O Gradle localiza uma instalação compatível mesmo quando o Java padrão do terminal ou da IDE é mais recente. Gere o APK ARM64 de teste para aparelhos Android físicos com:

```bash
pnpm android:build --debug --target aarch64 --apk
```

Java 21 precisa estar instalado e detectável pelo Gradle. No Android Studio, a sincronização também deve usar o wrapper do projeto; o critério de JVM seleciona o JDK 21 para o daemon.

O APK fica em `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. A variante `aarch64` empacota a biblioteca `arm64-v8a`; `x86_64` é destinada a emuladores compatíveis.

`pnpm tauri info` lista os pré-requisitos detectados. Antes de uma release, valide login, restauração e revogação de sessão, deep links com o processo aberto e fechado, tray, notificações, permissões, updater assinado, áudio, câmera, troca de dispositivo, compartilhamento de tela, suspensão e reconexão em dispositivos reais.

## Segurança de release

- não coloque senha, token de sessão, chave privada, Turnstile secret ou credencial Cloudflare em arquivos do aplicativo;
- assine instaladores e atualizações na CI protegida;
- restrinja a publicação de artefatos a tags revisadas;
- revise capabilities Tauri e permissões Android a cada plugin;
- teste a política CSP empacotada;
- publique associações HTTPS somente sob `connect.k0sec.org`;
- mantenha logs sem conteúdo de mensagens, tokens ou mídia.
