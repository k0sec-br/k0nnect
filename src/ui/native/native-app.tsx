import { useEffect } from 'react';

import type { AppPlatform } from '../../core/platform/app-platform';
import { startNativeDeepLinkListener } from '../../core/navigation/native-deep-links';
import { useNativeLifecycle } from '../../core/native/use-native-lifecycle';
import { useNativeUpdater } from '../../core/native/use-native-updater';
import { useAuth } from '../../features/auth/auth-context';
import { usePathname } from '../../lib/navigation';
import { AppPage } from '../../pages/app-page';
import { InvitePage } from '../../pages/invite-page';
import { InvitesSettingsPage } from '../../pages/invites-settings-page';
import { MediaSettingsPage } from '../../pages/media-settings-page';
import { RecoverPage } from '../../pages/recover-page';
import { SecuritySettingsPage } from '../../pages/security-settings-page';
import { SettingsPage } from '../../pages/settings-page';
import { DesktopLoginScreen } from '../desktop/desktop-login-screen';
import { MobileLoginScreen } from '../mobile/mobile-login-screen';
import { NativeConnectionScreen } from './native-connection-screen';
import { NativeStartupScreen } from './native-startup-screen';
import { NativeSessionExpiredDialog } from './native-session-expired-dialog';
import { NativeUpdateNotice } from './native-update-notice';

export function NativeApp({ platform }: { platform: Exclude<AppPlatform, 'web'> }) {
  const pathname = usePathname();
  const { acknowledgeSessionExpiration, bootstrapFailure, loading, refresh, sessionExpired, user } =
    useAuth();
  const updater = useNativeUpdater(platform);
  useNativeLifecycle();

  useEffect(() => {
    document.documentElement.dataset.appPlatform = platform;
    let stopListening: (() => void) | undefined;
    void startNativeDeepLinkListener().then((stop) => {
      stopListening = stop;
    });
    return () => {
      stopListening?.();
      delete document.documentElement.dataset.appPlatform;
    };
  }, [platform]);

  if (updater.busy) return <NativeStartupScreen message={updater.message} />;
  if (loading) return <NativeStartupScreen message="Preparando seu k0nnect..." />;
  if (!user && bootstrapFailure) {
    return <NativeConnectionScreen retrying={loading} onRetry={() => void refresh()} />;
  }
  if (pathname === '/invite') return <InvitePage nativePlatform={platform} />;
  if (!user) {
    if (pathname === '/recover') return <RecoverPage nativePlatform={platform} />;
    return platform === 'mobile' ? <MobileLoginScreen /> : <DesktopLoginScreen />;
  }

  let content;
  if (pathname === '/settings/security') content = <SecuritySettingsPage />;
  else if (pathname === '/settings/invites') content = <InvitesSettingsPage />;
  else if (pathname === '/settings/media') content = <MediaSettingsPage />;
  else if (pathname === '/settings') content = <SettingsPage />;
  else content = <AppPage nativePlatform={platform} />;
  return (
    <>
      <NativeUpdateNotice message={updater.warning} />
      {content}
      {sessionExpired && (
        <NativeSessionExpiredDialog
          onContinue={() => {
            acknowledgeSessionExpiration();
            window.history.replaceState({}, '', '/login');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        />
      )}
    </>
  );
}
