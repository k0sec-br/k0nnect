# Design system do frontend k0nnect

## Filosofia

O k0nnect é um aplicativo de comunicação privado, técnico e direto. O Discord é uma referência de modelo mental, densidade e navegação, não uma referência visual de marca. A interface usa a identidade oficial da K0Sec: preto como base, cinzas para profundidade, branco para conteúdo e violeta em estados de ação e seleção.

## Cores e superfícies

Os tokens ficam em `src/styles/tokens.css`.

| Token                                | Uso                               |
| ------------------------------------ | --------------------------------- |
| `--surface-root`                     | Fundo estrutural e rail de grupos |
| `--surface-sidebar`                  | Navegação e configurações         |
| `--surface-main`                     | Conteúdo principal                |
| `--surface-elevated`                 | Controles e overlays compactos    |
| `--surface-hover`                    | Estado interativo                 |
| `--surface-active`                   | Seleção persistente               |
| `--border-default`                   | Separação entre superfícies       |
| `--text-primary`                     | Conteúdo principal                |
| `--text-secondary`                   | Texto auxiliar                    |
| `--text-tertiary`                    | Metadados                         |
| `--accent`                           | Ações e seleção                   |
| `--success`, `--warning`, `--danger` | Estados semânticos                |

A profundidade vem de tons e bordas. Sombras ficam restritas a overlays. Gradientes e glows decorativos não fazem parte do sistema.

## Tipografia

- Space Grotesk: marca, títulos e cabeçalhos importantes.
- Inter: interface, listas, formulários e botões.
- JetBrains Mono: rótulos técnicos curtos e estados.

As fontes são self-hosted em `public/fonts`, preservando a política de conteúdo e evitando dependências externas.

## Espaçamento e geometria

A escala usa principalmente 4, 6, 8, 12, 16, 20, 24 e 32 pixels. Estruturas usam raio de 2 px; controles, 4 px; overlays especiais, 6 px. O raio circular fica reservado a avatares e indicadores de presença.

## Componentes e estados

Botões, campos, avatares, indicadores, tooltips e avisos compartilham tokens e estados consistentes: padrão, hover, ativo, foco visível, desabilitado e destrutivo. Controles de ícone possuem nome acessível e tooltip. Mute e deafen combinam ícone, texto acessível e estado pressionado, sem depender apenas da cor.

## Iconografia

Os ícones são SVGs de traço uniforme, com `stroke-linecap` e `stroke-linejoin` arredondados. Emojis e caracteres decorativos não são usados como ícones de produto.

## Movimento

Transições de cor, fundo e borda usam 140 ms. A interface respeita `prefers-reduced-motion`; movimentos decorativos e transformações exageradas são evitados.

## Layout da aplicação

No desktop amplo, o shell contém rail de grupos, canais, conteúdo e membros. Entre 768 e 1199 px, membros viram drawer. Abaixo de 768 px, canais e membros são drawers e os controles essenciais de voz ficam em uma barra inferior compacta.

A área principal da sala usa `AudioOnlyView`, isolada do shell, para aceitar futuramente visualizações de vídeo ou compartilhamento sem reestruturar a navegação.

## Layout de configurações

No desktop, configurações usam uma sidebar fixa de navegação e uma área de conteúdo centralizada com largura máxima de 960 px. Conta, dispositivos e segurança formam o grupo pessoal; convites aparecem em Administração somente para owner e admin. Cada área possui rota própria, mantendo a leitura e o foco de teclado previsíveis.

Abaixo de 760 px, a sidebar vira um menu sobreposto acionado pelo cabeçalho. A página selecionada ocupa toda a largura disponível, formulários passam para uma coluna e listas administrativas preservam linhas compactas. O fechamento pelo controle superior ou pela tecla `Escape` retorna à aplicação.

Informações de conta usam identidade, username e badge de role. Convites usam metadados contextuais e status textual, com confirmação explícita antes da revogação. Bordas e espaçamento separam seções sem transformar cada bloco em card.

## Acessibilidade

O sistema exige HTML semântico, um único título principal por tela, labels de formulário, foco visível, nomes acessíveis, `aria-current`, `aria-expanded`, alvos de toque adequados e contraste compatível com o tema escuro. Conteúdo não depende somente de cor para comunicar estado.
