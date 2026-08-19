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

  it('só encerra a câmera anterior após confirmar a substituição', async () => {
    const previousTrack = fakeTrack('video');
    const nextTrack = fakeTrack('video');
    const previousStream = fakeStream([previousTrack]);
    const nextStream = fakeStream([nextTrack]);
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(previousStream)
      .mockResolvedValueOnce(nextStream);
    const manager = new CameraManager({ getUserMedia } as unknown as MediaDevices);
    await manager.start('camera-front');
    const applyReplacement = vi.fn(() => Promise.resolve());

    expect(await manager.replace('camera-rear', applyReplacement)).toBe(nextStream);
    expect(applyReplacement).toHaveBeenCalledWith(nextTrack);
    expect(previousTrack.stop).toHaveBeenCalledOnce();
    expect(nextTrack.stop).not.toHaveBeenCalled();
  });

  it('preserva a câmera anterior quando a nova track não pode ser aplicada', async () => {
    const previousTrack = fakeTrack('video');
    const nextTrack = fakeTrack('video');
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(fakeStream([previousTrack]))
      .mockResolvedValueOnce(fakeStream([nextTrack]));
    const manager = new CameraManager({ getUserMedia } as unknown as MediaDevices);
    await manager.start('camera-front');

    await expect(
      manager.replace('camera-rear', () => Promise.reject(new Error('replaceTrack falhou'))),
    ).rejects.toThrow('replaceTrack falhou');
    expect(previousTrack.stop).not.toHaveBeenCalled();
    expect(nextTrack.stop).toHaveBeenCalledOnce();
    expect(manager.currentTrack()).toBe(previousTrack);
  });

  it('usa facingMode ideal como fallback sem interromper a câmera anterior', async () => {
    const previousTrack = fakeTrack('video');
    const fallbackTrack = fakeTrack('video');
    const fallbackStream = fakeStream([fallbackTrack]);
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(fakeStream([previousTrack]))
      .mockRejectedValueOnce(new DOMException('restrição inválida', 'OverconstrainedError'))
      .mockResolvedValueOnce(fallbackStream);
    const manager = new CameraManager({ getUserMedia } as unknown as MediaDevices);
    await manager.start('camera-front');
    const applyReplacement = vi.fn(() => Promise.resolve());

    await expect(manager.replace('camera-rear', applyReplacement, 'environment')).resolves.toBe(
      fallbackStream,
    );
    const mediaCalls = getUserMedia.mock.calls as unknown as [MediaStreamConstraints][];
    expect(mediaCalls.at(-1)?.[0]).toEqual({
      audio: false,
      video: expect.objectContaining({ facingMode: { ideal: 'environment' } }) as unknown,
    });
    expect(applyReplacement).toHaveBeenCalledWith(fallbackTrack);
    expect(previousTrack.stop).toHaveBeenCalledOnce();
  });

  it('cancela uma troca pendente quando o usuário encerra a câmera', async () => {
    const previousTrack = fakeTrack('video');
    const nextTrack = fakeTrack('video');
    let finishCapture: ((stream: MediaStream) => void) | undefined;
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(fakeStream([previousTrack]))
      .mockImplementationOnce(
        () =>
          new Promise<MediaStream>((resolve) => {
            finishCapture = resolve;
          }),
      );
    const manager = new CameraManager({ getUserMedia } as unknown as MediaDevices);
    await manager.start('camera-front');
    const replacement = manager.replace('camera-rear', () => Promise.resolve());
    manager.stop();
    finishCapture?.(fakeStream([nextTrack]));

    await expect(replacement).rejects.toMatchObject({ name: 'AbortError' });
    expect(previousTrack.stop).toHaveBeenCalledOnce();
    expect(nextTrack.stop).toHaveBeenCalledOnce();
    expect(manager.currentTrack()).toBeUndefined();
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
