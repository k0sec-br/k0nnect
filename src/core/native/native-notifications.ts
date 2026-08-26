import { isTauriApp } from '../platform/app-platform';
import { notificationContentVisible, notificationsMuted } from './native-preferences';

export async function notifyNativeMessage({
  content,
  conversationId,
  sender,
}: {
  content: string | null;
  conversationId: string;
  sender: string;
}): Promise<void> {
  if (!isTauriApp() || notificationsMuted() || document.visibilityState === 'visible') return;
  const { isPermissionGranted, sendNotification } = await import('@tauri-apps/plugin-notification');
  if (!(await isPermissionGranted())) return;
  sendNotification({
    title: sender,
    body:
      notificationContentVisible() && content
        ? content.slice(0, 160)
        : 'Você recebeu uma nova mensagem no k0nnect.',
    autoCancel: true,
    extra: { conversationId },
  });
}

export async function requestNativeNotificationPermission(): Promise<boolean> {
  if (!isTauriApp()) return false;
  const { isPermissionGranted, requestPermission } =
    await import('@tauri-apps/plugin-notification');
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}
