import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppPlatform } from '../platform/app-platform';

interface NativeUpdaterState {
  busy: boolean;
  message: string;
  warning: string;
}

const UPDATER_ENABLED = import.meta.env.VITE_K0NNECT_UPDATER_ENABLED === 'true';

function formatProgress(downloaded: number, total: number): string {
  const downloadedMegabytes = downloaded / 1_048_576;
  const totalMegabytes = total / 1_048_576;
  return `${downloadedMegabytes.toFixed(1)} MB / ${totalMegabytes.toFixed(1)} MB`;
}

export function useNativeUpdater(platform: Exclude<AppPlatform, 'web'>): NativeUpdaterState {
  const [state, setState] = useState<NativeUpdaterState>({
    busy: platform === 'desktop' && UPDATER_ENABLED,
    message: 'Verificando atualizações...',
    warning: '',
  });
  const runningRef = useRef(false);

  const checkForUpdates = useCallback(async () => {
    if (platform !== 'desktop' || runningRef.current) return;
    runningRef.current = true;
    setState({ busy: true, message: 'Verificando atualizações...', warning: '' });
    try {
      const [{ check }, { relaunch }] = await Promise.all([
        import('@tauri-apps/plugin-updater'),
        import('@tauri-apps/plugin-process'),
      ]);
      const update = await check({ timeout: 20_000 });
      if (!update) {
        setState({ busy: false, message: '', warning: '' });
        return;
      }
      let downloaded = 0;
      let total = 0;
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          setState({ busy: true, message: 'Baixando atualização...', warning: '' });
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          setState({
            busy: true,
            message: total > 0 ? formatProgress(downloaded, total) : 'Baixando atualização...',
            warning: '',
          });
        } else {
          setState({ busy: true, message: 'Instalando atualização...', warning: '' });
        }
      });
      await update.install();
      setState({ busy: true, message: 'Reiniciando...', warning: '' });
      await relaunch();
    } catch {
      setState({
        busy: false,
        message: '',
        warning: 'Não foi possível verificar atualizações agora.',
      });
    } finally {
      runningRef.current = false;
    }
  }, [platform]);

  useEffect(() => {
    if (platform !== 'desktop') return;
    if (UPDATER_ENABLED) void checkForUpdates();
    const listener = listen('native:check-updates', () => void checkForUpdates());
    return () => {
      void listener.then((stop) => stop());
    };
  }, [checkForUpdates, platform]);

  return state;
}
