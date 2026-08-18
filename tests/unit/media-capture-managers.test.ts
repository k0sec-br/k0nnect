import { describe, expect, it, vi } from 'vitest';

import { CameraManager, ScreenShareManager } from '../../src/features/voice/media-capture-managers';

function fakeTrack(kind: 'audio' | 'video') {
  return {
    kind,
    stop: vi.fn(),
    getSettings: () => ({ deviceId: `${kind}-device` }),
  } as unknown as MediaStreamTrack;
}

function fakeStream(videoTracks: MediaStreamTrack[], audioTracks: MediaStreamTrack[] = []) {
  return {
    getTracks: () => [...videoTracks, ...audioTracks],
    getVideoTracks: () => videoTracks,
    getAudioTracks: () => audioTracks,
  } as unknown as MediaStream;
}

describe('CameraManager', () => {
  it('torna start e stop idempotentes e encerra a webcam', async () => {
    const videoTrack = fakeTrack('video');
    const stream = fakeStream([videoTrack]);
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    const manager = new CameraManager({ getUserMedia } as unknown as MediaDevices);

    const [first, second] = await Promise.all([
      manager.start('camera-1'),
      manager.start('camera-1'),
    ]);
    expect(first).toBe(stream);
    expect(second).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledOnce();
    manager.stop();
    manager.stop();
    expect(videoTrack.stop).toHaveBeenCalledOnce();
  });

  it('propaga permissão negada sem manter uma operação presa', async () => {
    const getUserMedia = vi.fn(() => Promise.reject(new DOMException('negado', 'NotAllowedError')));
    const manager = new CameraManager({ getUserMedia } as unknown as MediaDevices);
    await expect(manager.start()).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(manager.start()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe('ScreenShareManager', () => {
  it.each([false, true])('aceita compartilhamento com áudio=%s', async (withAudio) => {
    const videoTrack = fakeTrack('video');
    const audioTrack = fakeTrack('audio');
    const stream = fakeStream([videoTrack], withAudio ? [audioTrack] : []);
    const getDisplayMedia = vi.fn(() => Promise.resolve(stream));
    const manager = new ScreenShareManager({ getDisplayMedia } as unknown as MediaDevices);

    expect(await manager.start()).toBe(stream);
    expect(await manager.start()).toBe(stream);
    expect(getDisplayMedia).toHaveBeenCalledOnce();
    manager.stop();
    expect(videoTrack.stop).toHaveBeenCalledOnce();
    expect(audioTrack.stop).toHaveBeenCalledTimes(withAudio ? 1 : 0);
  });

  it('trata cancelamento do picker sem ativar compartilhamento', async () => {
    const getDisplayMedia = vi.fn(() =>
      Promise.reject(new DOMException('cancelado', 'NotAllowedError')),
    );
    const manager = new ScreenShareManager({ getDisplayMedia } as unknown as MediaDevices);
    await expect(manager.start()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});
