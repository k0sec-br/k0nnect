import { describe, expect, it } from 'vitest';

import { describeMediaDevices, normalizeDeviceLabel } from '../../src/features/voice/device-label';
import {
  clampScreenShareTransform,
  clampZoom,
} from '../../src/features/voice/screen-share-transform';
import {
  mediaTrackAspectRatio,
  shouldMirrorLocalCamera,
} from '../../src/features/voice/video-layout';

function mediaDevice(deviceId: string, label: string): MediaDeviceInfo {
  return { deviceId, groupId: 'group', kind: 'audioinput', label } as MediaDeviceInfo;
}

function videoTrack(settings: MediaTrackSettings): MediaStreamTrack {
  return { getSettings: () => settings } as MediaStreamTrack;
}

describe('labels de dispositivos', () => {
  it('remove IDs técnicos e apresenta aliases do navegador em português', () => {
    expect(normalizeDeviceLabel('Razer Seiren Mini (1532:0531)', 'Microfone 1')).toEqual({
      detail: '',
      name: 'Razer Seiren Mini',
    });
    expect(
      normalizeDeviceLabel('Default - Razer Seiren Mini (Razer Seiren Mini)', 'Microfone 1'),
    ).toEqual({ detail: 'Padrão', name: 'Razer Seiren Mini' });
    expect(
      normalizeDeviceLabel('Communications - Razer Seiren Mini (Razer Seiren Mini)', 'Microfone 1'),
    ).toEqual({ detail: 'Comunicações', name: 'Razer Seiren Mini' });
  });

  it('diferencia labels visuais idênticos sem expor deviceId', () => {
    const devices = describeMediaDevices(
      [mediaDevice('technical-id-a', 'Nitro5 Mic'), mediaDevice('technical-id-b', 'Nitro5 Mic')],
      'Microfone',
    );
    expect(devices.map((device) => device.name)).toEqual(['Nitro5 Mic 1', 'Nitro5 Mic 2']);
    expect(devices.map((device) => device.title).join(' ')).not.toContain('technical-id');
  });
});

describe('transformação do compartilhamento de tela', () => {
  it('limita o zoom entre 1x e 4x', () => {
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(6)).toBe(4);
  });

  it('limita o pan e reseta a posição em 1x', () => {
    expect(clampScreenShareTransform({ scale: 1, x: 50, y: -50 }, 300, 200)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
    expect(clampScreenShareTransform({ scale: 2, x: 500, y: -500 }, 300, 200)).toEqual({
      scale: 2,
      x: 150,
      y: -100,
    });
    expect(clampScreenShareTransform({ scale: 5, x: 0, y: 0 }, 300, 200).scale).toBe(4);
  });
});

describe('layout de câmera', () => {
  it.each([
    [{ width: 640, height: 480 }, 4 / 3],
    [{ width: 1920, height: 1080 }, 16 / 9],
    [{ width: 720, height: 1280 }, 720 / 1280],
  ])('calcula a proporção original de %o', (settings, expected) => {
    expect(mediaTrackAspectRatio(videoTrack(settings))).toBeCloseTo(expected);
  });

  it('espelha somente câmera local que não é traseira', () => {
    expect(shouldMirrorLocalCamera(videoTrack({ facingMode: 'user' }))).toBe(true);
    expect(shouldMirrorLocalCamera(videoTrack({ facingMode: 'environment' }))).toBe(false);
  });
});
