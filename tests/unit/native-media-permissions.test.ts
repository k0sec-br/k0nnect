import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NativeMediaPermissionRequest } from '../../src/core/native/native-media-permissions';

function installNativeEnvironment() {
  const storedValues = new Map<string, string>();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => storedValues.set(key, value),
  });
  return storedValues;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('consentimento nativo de mídia', () => {
  it('executa a captura no clique de aprovação e memoriza a explicação', async () => {
    const storedValues = installNativeEnvironment();
    const { runWithNativeMediaPermission, subscribeToNativeMediaPermission } =
      await import('../../src/core/native/native-media-permissions');
    const operation = vi.fn(() => Promise.resolve('microfone ativo'));
    const permissionRequests: NativeMediaPermissionRequest[] = [];
    const unsubscribe = subscribeToNativeMediaPermission((request) => {
      if (request) permissionRequests.push(request);
    });

    const firstResult = runWithNativeMediaPermission('microphone', operation);
    expect(operation).not.toHaveBeenCalled();
    expect(permissionRequests[0]?.kind).toBe('microphone');
    permissionRequests[0]?.approve();
    await expect(firstResult).resolves.toBe('microfone ativo');
    expect(storedValues.get('k0nnect.native-media-consent.v1.microphone')).toBe('accepted');

    await expect(runWithNativeMediaPermission('microphone', operation)).resolves.toBe(
      'microfone ativo',
    );
    expect(operation).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('não inicia a captura quando o usuário escolhe agora não', async () => {
    installNativeEnvironment();
    const { runWithNativeMediaPermission, subscribeToNativeMediaPermission } =
      await import('../../src/core/native/native-media-permissions');
    const operation = vi.fn(() => Promise.resolve('tela ativa'));
    let cancelRequest: (() => void) | undefined;
    const unsubscribe = subscribeToNativeMediaPermission((request) => {
      cancelRequest = request ? () => request.cancel() : undefined;
    });

    const result = runWithNativeMediaPermission('screen', operation);
    cancelRequest?.();
    await expect(result).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(operation).not.toHaveBeenCalled();
    unsubscribe();
  });
});
