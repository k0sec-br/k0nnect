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

- [ ] perda temporária de internet reconecta presença e voz
- [ ] reload substitui a conexão anterior sem duplicar participante
- [ ] reconnect não cria áudio duplicado
- [ ] negação da permissão exibe mensagem humana
- [ ] microfone desconectado permite escolher outro dispositivo ou sair

Continue com o checklist de câmera e tela em [manual-video-test.md](manual-video-test.md). Registre navegador, sistema, tipo de rede, quantidade de participantes, resultado e request ID correlato quando disponível. Nunca registre SDP, cookies, convite, recovery code ou credencial TURN.
