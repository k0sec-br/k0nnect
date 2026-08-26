import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { openNativeConversation } from '../navigation/native-deep-links';
import { navigate } from '../../lib/navigation';
import { isTauriApp } from '../platform/app-platform';
import { notificationsMuted, setNotificationsMuted } from './native-preferences';

async function openNotificationConversation(conversationId: string): Promise<void> {
  if (!openNativeConversation(conversationId)) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const window = getCurrentWindow();
  await window.show();
  await window.setFocus();
}

export function useNativeLifecycle(): void {
  useEffect(() => {
    if (!isTauriApp()) return;
    const listeners = Promise.all([
      listen<string>('native:navigate', (event) => navigate(event.payload)),
      listen('native:toggle-notifications', () => {
        setNotificationsMuted(!notificationsMuted());
      }),
    ]);
    const notificationListener = import('@tauri-apps/plugin-notification').then(({ onAction }) =>
      onAction((notification) => {
        const conversationId = notification.extra?.conversationId;
        if (typeof conversationId === 'string') {
          void openNotificationConversation(conversationId);
        }
      }),
    );
    return () => {
      void listeners.then((unlisten) => unlisten.forEach((stop) => stop()));
      void notificationListener.then((listener) => listener.unregister());
    };
  }, []);
}
