# Checklist manual de Realtime

Execute em produção/staging com contas descartáveis autorizadas. Não grave áudio nem capture tokens em evidências.

## Topologias e capacidade

- [ ] PC Wi-Fi ↔ celular 4G/5G
- [ ] PC ↔ PC em redes diferentes
- [ ] 2 usuários simultâneos
- [ ] 3 usuários simultâneos
- [ ] 5 usuários simultâneos

## Controles

- [ ] mute interrompe envio e atualiza presença
- [ ] áudio desativado interrompe reprodução e transmissão
- [ ] áudio reativado restaura microfone ativo quando essa era a intenção anterior
- [ ] áudio reativado mantém microfone desativado quando essa era a intenção anterior
- [ ] alterar a intenção do microfone durante áudio desativado produz o estado esperado ao reativar
- [ ] speaking aparece e desaparece sem depender apenas de cor
- [ ] troca de microfone mantém a chamada
- [ ] falha na troca de microfone preserva a track anterior
- [ ] abrir configurações e retornar mantém o mesmo WebSocket e a mesma sessão de mídia
- [ ] sair encerra trilha e presença
- [ ] câmera e tela ligadas não alteram mute, deafen ou speaking

## Resiliência

- [ ] desligar Wi-Fi por 3 s, 10 s e 30 s reconecta presença e voz sem ação manual
- [ ] alternar Wi-Fi para 4G/5G recupera a chamada quando a plataforma permite
- [ ] queda somente do WebSocket preserva áudio/vídeo enquanto WebRTC permanece saudável
- [ ] queda somente do WebRTC preserva o socket e reconstrói uma única sessão de mídia
- [ ] queda simultânea de socket e WebRTC produz um único loop de recovery
- [ ] reload substitui a conexão anterior sem duplicar participante
- [ ] reconnect não cria áudio duplicado
- [ ] negação da permissão exibe mensagem humana
- [ ] microfone desconectado permite escolher outro dispositivo ou sair

## Background e retomada

Registre duração, navegador, sistema operacional e se a plataforma suspendeu captura ou execução.

- [ ] trocar para outra aba por 30 s, 2 min, 5 min e 10 min; ao voltar, a UI reconcilia imediatamente
- [ ] minimizar o navegador por 30 s, 2 min, 5 min e 10 min; áudio continua quando permitido
- [ ] Android Chrome: ir à tela inicial, usar outro app e retornar
- [ ] iOS Safari: ir à tela inicial, usar outro app e retornar
- [ ] manter câmera ativa durante background e registrar qualquer limitação aplicada pelo navegador/SO
- [ ] manter tela ativa durante background e confirmar que a captura segue a política do navegador
- [ ] testar `hidden → rede offline → visible`; deve existir somente um recovery

## Tela e câmera durante falhas

- [ ] dois clientes: parar tela pelo k0nnect remove a tela remota imediatamente e preserva voz/câmera
- [ ] parar pelo controle nativo do navegador produz o mesmo resultado sem erro genérico
- [ ] fechar a janela compartilhada encerra tela e preserva voz/câmera
- [ ] executar stop + `track.onended` + resposta atrasada; ocorre um único encerramento lógico
- [ ] alternar câmera frontal/traseira por 10 ciclos em dispositivo físico sem reiniciar microfone
- [ ] negar/falhar a câmera nova preserva a câmera anterior e mostra erro específico
- [ ] executar troca de câmera durante interrupção de rede; não ficam tracks ou publicações órfãs
- [ ] validar botão “Trocar câmera” em 390 × 844: superfície 1:1, pelo menos 44 px, SVG sem distorção e alinhamento correto

## Teste prolongado

Execute uma chamada de 30–60 minutos combinando background, configurações, câmera on/off, frontal/traseira, tela start/stop e interrupção curta de rede. Ao final, verifique no painel de desenvolvimento:

- [ ] crescimento contínuo de memória ausente
- [ ] uma PeerConnection ativa por participante
- [ ] um WebSocket ativo por participante
- [ ] publicações sem duplicidade
- [ ] ausência de MediaStreamTracks órfãs
- [ ] tentativas de recovery estabilizadas após cada recuperação

Continue com o checklist de câmera e tela em [manual-video-test.md](manual-video-test.md). Registre navegador, sistema, tipo de rede, quantidade de participantes, resultado e request ID correlato quando disponível. Nunca registre SDP, cookies, convite, recovery code ou credencial TURN.
