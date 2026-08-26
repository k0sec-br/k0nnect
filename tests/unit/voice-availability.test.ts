import { describe, expect, it } from 'vitest';

import { voiceAvailability } from '../../src/features/voice/voice-availability';

describe('disponibilidade de voz', () => {
  const base = {
    connectionId: null,
    connectionState: 'connecting' as const,
    mediaSupported: true,
    realtimeEnabled: true,
    roomAvailable: true,
  };

  it('aguarda a conexão realtime antes de liberar a entrada', () => {
    expect(voiceAvailability(base)).toEqual({
      canJoin: false,
      message: 'Conectando ao serviço de voz…',
    });
  });

  it('libera a entrada somente quando a conexão e a sala estão prontas', () => {
    expect(voiceAvailability({ ...base, connectionId: 'connection_1' })).toEqual({
      canJoin: true,
      message: '',
    });
  });

  it('explica quando realtime está desativado', () => {
    expect(voiceAvailability({ ...base, realtimeEnabled: false })).toEqual({
      canJoin: false,
      message: 'Voz indisponível neste ambiente.',
    });
  });

  it('bloqueia a entrada quando o componente do sistema não oferece WebRTC', () => {
    expect(voiceAvailability({ ...base, mediaSupported: false })).toEqual({
      canJoin: false,
      message: 'WebRTC indisponível neste sistema.',
    });
  });
});
