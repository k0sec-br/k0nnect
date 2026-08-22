const CALL_RESUME_MAX_AGE_MS = 60_000;

export interface CallResumeState {
  cameraEnabled: boolean;
  conversationId: string;
  savedAt: number;
}

function storageKey(serverId: string, userId: string) {
  return `k0nnect:call-resume:${serverId}:${userId}`;
}

function storageAvailable() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function loadCallResumeState(serverId: string, userId: string): CallResumeState | null {
  if (!storageAvailable()) return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(serverId, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as CallResumeState).conversationId !== 'string' ||
      typeof (parsed as CallResumeState).cameraEnabled !== 'boolean' ||
      typeof (parsed as CallResumeState).savedAt !== 'number' ||
      Date.now() - (parsed as CallResumeState).savedAt > CALL_RESUME_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(storageKey(serverId, userId));
      return null;
    }
    return parsed as CallResumeState;
  } catch {
    return null;
  }
}

export function saveCallResumeState(
  serverId: string,
  userId: string,
  state: Omit<CallResumeState, 'savedAt'>,
) {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.setItem(
      storageKey(serverId, userId),
      JSON.stringify({ ...state, savedAt: Date.now() }),
    );
  } catch {
    // Storage can be unavailable without preventing a call from continuing.
  }
}

export function clearCallResumeState(serverId: string, userId: string) {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.removeItem(storageKey(serverId, userId));
  } catch {
    // Storage can be unavailable without preventing a call from continuing.
  }
}
