export type CallStatus = 'connected' | 'idle' | 'joining' | 'reconnecting' | 'recovering';

export function hasActiveCall(status: CallStatus): boolean {
  return status !== 'idle';
}

export function shouldShowCallPanel(status: CallStatus, dismissed: boolean): boolean {
  return hasActiveCall(status) && !dismissed;
}

export function callStatusLabel(status: CallStatus): string {
  switch (status) {
    case 'joining':
      return 'Conectando à chamada';
    case 'reconnecting':
      return 'Reconectando à chamada';
    case 'recovering':
      return 'Recuperando a chamada';
    case 'connected':
      return 'Chamada em andamento';
    default:
      return '';
  }
}
