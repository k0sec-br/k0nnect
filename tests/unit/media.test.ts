import { describe, expect, it } from 'vitest';

import { mediaErrorMessage } from '../../src/features/voice/media-errors';
import { realtimeSessionRequestSchema } from '../../shared/schemas/realtime';
import { findAudioTransceiverMid } from '../../worker/realtime/sdp';

describe('camada de mídia', () => {
  it.each([
    ['NotAllowedError', 'O acesso ao microfone foi bloqueado'],
    ['NotFoundError', 'Não encontramos um microfone disponível'],
    ['NotReadableError', 'Seu microfone está sendo usado'],
  ])('mapeia %s para mensagem humana', (errorName, expectedMessage) => {
    expect(mediaErrorMessage(new DOMException('detalhe interno', errorName))).toContain(
      expectedMessage,
    );
    expect(mediaErrorMessage(new DOMException('detalhe interno', errorName))).not.toContain(
      errorName,
    );
  });

  it('não vaza detalhes técnicos em falha de rede', () => {
    expect(mediaErrorMessage(new Error('RTC error 1202'))).toBe(
      'Não conseguimos estabelecer a conexão de voz. Verifique sua internet e tente novamente.',
    );
  });

  it('aceita negociação de áudio e recusa campos de vídeo ou tela', () => {
    const baseRequest = {
      action: 'publish',
      roomId: 'room_general',
      connectionId: crypto.randomUUID(),
      sessionId: 'session_1',
      mid: '0',
      sessionDescription: { type: 'offer', sdp: 'v=0' },
    };
    expect(realtimeSessionRequestSchema.safeParse(baseRequest).success).toBe(true);
    expect(realtimeSessionRequestSchema.safeParse({ ...baseRequest, mid: '' }).success).toBe(false);
    expect(realtimeSessionRequestSchema.safeParse({ ...baseRequest, mid: undefined }).success).toBe(
      true,
    );
    expect(
      realtimeSessionRequestSchema.safeParse({ ...baseRequest, mediaKind: 'video' }).success,
    ).toBe(false);
  });

  it('recupera o mid da faixa de áudio para clientes ainda em cache', () => {
    const sdp = [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=mid:video-0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=mid:audio-1',
    ].join('\r\n');

    expect(findAudioTransceiverMid(sdp)).toBe('audio-1');
    expect(
      findAudioTransceiverMid('v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0'),
    ).toBeUndefined();
  });
});
