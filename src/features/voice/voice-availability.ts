export type VoiceAvailability =
  { canJoin: true; message: '' } | { canJoin: false; message: string };

export function voiceAvailability({
  connectionId,
  connectionState,
  mediaSupported,
  realtimeEnabled,
  roomAvailable,
}: {
  connectionId: string | null;
  connectionState: 'connected' | 'connecting' | 'disconnected' | 'offline' | 'reconnecting';
  mediaSupported: boolean;
  realtimeEnabled: boolean | undefined;
  roomAvailable: boolean;
}): VoiceAvailability {
  if (realtimeEnabled === undefined) {
    return { canJoin: false, message: 'Preparando serviço de voz…' };
  }
  if (!realtimeEnabled) {
    return { canJoin: false, message: 'Voz indisponível neste ambiente.' };
  }
  if (!mediaSupported) {
    return { canJoin: false, message: 'WebRTC indisponível neste sistema.' };
  }
  if (!roomAvailable) {
    return { canJoin: false, message: 'Este espaço não possui um canal de voz.' };
  }
  if (connectionId) return { canJoin: true, message: '' };
  if (connectionState === 'offline' || connectionState === 'disconnected') {
    return { canJoin: false, message: 'Sem conexão com o serviço de voz.' };
  }
  return { canJoin: false, message: 'Conectando ao serviço de voz…' };
}
