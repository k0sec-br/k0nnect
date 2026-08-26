import { useEffect, useState } from 'react';

export type AppPlatform = 'web' | 'desktop' | 'mobile';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriApp(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

function detectNativePlatform(): AppPlatform {
  if (!isTauriApp()) return 'web';
  if (navigator.userAgent.includes('Android')) return 'mobile';
  return 'desktop';
}

export function useAppPlatform(): AppPlatform {
  const [platform, setPlatform] = useState<AppPlatform>(detectNativePlatform);

  useEffect(() => {
    setPlatform(detectNativePlatform());
  }, []);

  return platform;
}
