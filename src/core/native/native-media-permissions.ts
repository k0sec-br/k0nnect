import { isTauriApp } from '../platform/app-platform';

export type NativeMediaPermissionKind = 'microphone' | 'camera' | 'screen';

export interface NativeMediaPermissionRequest {
  id: number;
  kind: NativeMediaPermissionKind;
  approve(): void;
  cancel(): void;
}

type PermissionOperation<T> = () => Promise<T>;
type PermissionListener = (request: NativeMediaPermissionRequest | null) => void;

const CONSENT_STORAGE_PREFIX = 'k0nnect.native-media-consent.v1';
const permissionListeners = new Set<PermissionListener>();
const permissionQueue: NativeMediaPermissionRequest[] = [];
let activePermissionRequest: NativeMediaPermissionRequest | null = null;
let nextPermissionRequestId = 1;

function consentStorageKey(kind: NativeMediaPermissionKind): string {
  return `${CONSENT_STORAGE_PREFIX}.${kind}`;
}

function hasConsent(kind: NativeMediaPermissionKind): boolean {
  try {
    return localStorage.getItem(consentStorageKey(kind)) === 'accepted';
  } catch {
    return false;
  }
}

function rememberConsent(kind: NativeMediaPermissionKind): void {
  try {
    localStorage.setItem(consentStorageKey(kind), 'accepted');
  } catch {
    // A autorização do sistema continua sendo a fonte de verdade quando o armazenamento falha.
  }
}

function normalizeOperationError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Falha ao solicitar acesso à mídia', { cause: error });
}

function notifyPermissionListeners(): void {
  permissionListeners.forEach((listener) => listener(activePermissionRequest));
}

function showNextPermissionRequest(): void {
  activePermissionRequest = permissionQueue.shift() ?? null;
  notifyPermissionListeners();
}

export function subscribeToNativeMediaPermission(listener: PermissionListener): () => void {
  permissionListeners.add(listener);
  listener(activePermissionRequest);
  return () => {
    permissionListeners.delete(listener);
  };
}

export function runWithNativeMediaPermission<T>(
  kind: NativeMediaPermissionKind,
  operation: PermissionOperation<T>,
): Promise<T> {
  if (!isTauriApp() || hasConsent(kind)) return operation();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let started = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      showNextPermissionRequest();
      return true;
    };
    const request: NativeMediaPermissionRequest = {
      id: nextPermissionRequestId,
      kind,
      approve() {
        if (settled || started) return;
        started = true;
        rememberConsent(kind);
        let operationResult: Promise<T>;
        try {
          operationResult = operation();
        } catch (error) {
          if (finish()) reject(normalizeOperationError(error));
          return;
        }
        void operationResult.then(
          (result) => {
            if (finish()) resolve(result);
          },
          (error: unknown) => {
            if (finish()) reject(normalizeOperationError(error));
          },
        );
      },
      cancel() {
        if (!finish()) return;
        reject(new DOMException('Permissão cancelada pelo usuário', 'NotAllowedError'));
      },
    };
    nextPermissionRequestId += 1;
    permissionQueue.push(request);
    if (!activePermissionRequest) showNextPermissionRequest();
  });
}
