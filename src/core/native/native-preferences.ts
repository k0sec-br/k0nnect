const NOTIFICATIONS_MUTED_KEY = 'k0nnect:native:notifications-muted';
const NOTIFICATION_CONTENT_KEY = 'k0nnect:native:notification-content';

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Preferências não sensíveis podem permanecer apenas durante esta execução.
  }
}

export function notificationsMuted(): boolean {
  return readBoolean(NOTIFICATIONS_MUTED_KEY, false);
}

export function setNotificationsMuted(muted: boolean): void {
  writeBoolean(NOTIFICATIONS_MUTED_KEY, muted);
  window.dispatchEvent(new Event('k0nnect:native-preferences-changed'));
}

export function notificationContentVisible(): boolean {
  return readBoolean(NOTIFICATION_CONTENT_KEY, false);
}

export function setNotificationContentVisible(visible: boolean): void {
  writeBoolean(NOTIFICATION_CONTENT_KEY, visible);
  window.dispatchEvent(new Event('k0nnect:native-preferences-changed'));
}
