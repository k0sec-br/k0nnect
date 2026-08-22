const REALTIME_RESUME_MAX_AGE_MS = 60_000;

interface RealtimeResumeIdentity {
  connectionEpoch: number;
  connectionId: string;
  savedAt: number;
}

function storageKey(serverId: string, userId: string) {
  return `k0nnect:realtime-resume:${serverId}:${userId}`;
}

function sessionStorageAvailable() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function loadRealtimeResumeIdentity(
  serverId: string,
  userId: string,
): RealtimeResumeIdentity | null {
  if (!sessionStorageAvailable()) return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(serverId, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as RealtimeResumeIdentity).connectionId !== 'string' ||
      typeof (parsed as RealtimeResumeIdentity).connectionEpoch !== 'number' ||
      typeof (parsed as RealtimeResumeIdentity).savedAt !== 'number' ||
      Date.now() - (parsed as RealtimeResumeIdentity).savedAt > REALTIME_RESUME_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(storageKey(serverId, userId));
      return null;
    }
    return parsed as RealtimeResumeIdentity;
  } catch {
    return null;
  }
}

export function saveRealtimeResumeIdentity(
  serverId: string,
  userId: string,
  connection: Omit<RealtimeResumeIdentity, 'savedAt'>,
) {
  if (!sessionStorageAvailable()) return;
  try {
    window.sessionStorage.setItem(
      storageKey(serverId, userId),
      JSON.stringify({ ...connection, savedAt: Date.now() }),
    );
  } catch {
    // A private browsing policy may deny session storage without affecting realtime.
  }
}

export function clearRealtimeResumeIdentity(serverId: string, userId: string) {
  if (!sessionStorageAvailable()) return;
  try {
    window.sessionStorage.removeItem(storageKey(serverId, userId));
  } catch {
    // A private browsing policy may deny session storage without affecting realtime.
  }
}
