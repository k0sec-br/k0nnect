export const VOICE_MEDIA_UNSUPPORTED_MESSAGE =
  'Este ambiente não oferece suporte às chamadas WebRTC do k0nnect.';

export class UnsupportedVoiceMediaError extends Error {
  override name = 'UnsupportedVoiceMediaError';

  constructor() {
    super(VOICE_MEDIA_UNSUPPORTED_MESSAGE);
  }
}

export function supportsVoiceMedia(): boolean {
  return (
    typeof globalThis.RTCPeerConnection === 'function' &&
    typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function'
  );
}

export function assertVoiceMediaSupport(): void {
  if (!supportsVoiceMedia()) throw new UnsupportedVoiceMediaError();
}
