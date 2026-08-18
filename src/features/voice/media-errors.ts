export function mediaErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'O acesso ao microfone foi bloqueado. Libere a permissão no navegador para entrar na chamada.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'Não encontramos um microfone disponível.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'Seu microfone está sendo usado por outro aplicativo ou não pôde ser iniciado.';
    }
  }
  return 'Não conseguimos estabelecer a conexão de voz. Verifique sua internet e tente novamente.';
}
