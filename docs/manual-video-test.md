# Checklist manual de câmera e compartilhamento

Execute em staging ou produção com contas descartáveis autorizadas. Não grave tela/áudio nem inclua conteúdo privado nas evidências.

## Teste 1 — câmera básica

- [ ] entrar na voz e ligar câmera por ação explícita
- [ ] confirmar vídeo local espelhado e remoto sem espelhamento
- [ ] desligar câmera e confirmar no indicador do navegador que a webcam parou

## Teste 2 — duas câmeras

- [ ] conectar duas contas em redes diferentes
- [ ] ligar as duas câmeras simultaneamente
- [ ] confirmar grade responsiva, nomes e participante sem câmera

## Teste 3 — seleção e remoção de câmera

- [ ] trocar de câmera durante a chamada sem interromper voz
- [ ] remover a webcam ativa
- [ ] confirmar mensagem amigável, fim da câmera e continuidade do microfone

## Teste 4 — prévia

- [ ] abrir `/settings/media` e confirmar que a câmera permanece desligada
- [ ] iniciar e parar a prévia
- [ ] sair da página e confirmar que a webcam parou

## Teste 5 — tela sem áudio

- [ ] clicar em compartilhar e escolher uma janela/tela pelo picker real
- [ ] confirmar palco, texto legível, miniaturas e tela cheia
- [ ] parar pelo botão do k0nnect

## Teste 6 — tela com áudio

- [ ] escolher uma fonte compatível e habilitar o áudio no picker
- [ ] confirmar indicador “com áudio” e reprodução remota
- [ ] repetir com uma fonte sem áudio e confirmar que a publicação funciona

## Teste 7 — encerramento pelo navegador

- [ ] iniciar tela e usar “Parar compartilhamento” do navegador
- [ ] confirmar remoção do palco, track e anúncio da publicação

## Teste 8 — câmera e tela simultâneas

- [ ] ligar câmera e compartilhar tela na mesma sessão
- [ ] confirmar palco da tela, câmera na faixa de miniaturas e voz sem duplicação

## Teste 9 — múltiplas telas

- [ ] duas contas compartilham telas simultaneamente
- [ ] alternar a tela principal pela miniatura
- [ ] encerrar uma tela e confirmar que a outra permanece

## Teste 10 — negação, corrida e reconexão

- [ ] negar câmera e confirmar que a voz permanece
- [ ] cancelar o picker e confirmar que câmera/voz permanecem
- [ ] alternar câmera rapidamente sem criar duas publicações
- [ ] iniciar câmera e tela quase simultaneamente
- [ ] perder e recuperar rede; confirmar ausência de tracks duplicadas

## Navegadores e mobile

- [ ] Chromium desktop
- [ ] Firefox desktop
- [ ] Safari desktop, quando houver dispositivo disponível
- [ ] Chrome Android ou navegador Chromium equivalente
- [ ] Safari iOS para câmera; registrar compartilhamento como indisponível quando a API não existir

Para cada execução, registre data, versão do navegador, sistema, topologia de rede e resultado. O painel de diagnóstico WebRTC aparece somente no build de desenvolvimento; não copie SDP, ICE, labels de dispositivos ou credenciais.
