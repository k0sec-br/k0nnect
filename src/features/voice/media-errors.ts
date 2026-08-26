import { isTauriApp } from '../../core/platform/app-platform';

export function mediaErrorMessage(
  error: unknown,
  mediaLabel: 'microfone' | 'câmera' | 'compartilhamento' = 'microfone',
): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      const permissionLocation = isTauriApp()
        ? 'nas configurações de privacidade do sistema'
        : 'nas permissões do navegador';
      return `O acesso ao ${mediaLabel} foi bloqueado ou cancelado. Revise ${permissionLocation} e tente novamente.`;
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      if (mediaLabel === 'microfone') return 'Não encontramos um microfone disponível.';
      return `Não encontramos ${mediaLabel === 'compartilhamento' ? 'uma fonte de compartilhamento' : `um dispositivo de ${mediaLabel}`} disponível.`;
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      if (mediaLabel === 'microfone') {
        return 'Seu microfone está sendo usado por outro aplicativo ou não pôde ser iniciado.';
      }
      return `O ${mediaLabel} está sendo usado por outro aplicativo ou não pôde ser iniciado.`;
    }
  }
  return `Não conseguimos estabelecer a conexão de ${mediaLabel === 'microfone' ? 'voz' : 'mídia'}. Verifique sua internet e tente novamente.`;
}
