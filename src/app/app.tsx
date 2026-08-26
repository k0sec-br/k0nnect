import { useEffect, type ReactNode } from 'react';

import { useAppPlatform } from '../core/platform/app-platform';
import { useAuth } from '../features/auth/auth-context';
import { navigate, usePathname } from '../lib/navigation';
import { AppPage } from '../pages/app-page';
import { InvitePage } from '../pages/invite-page';
import { InvitesSettingsPage } from '../pages/invites-settings-page';
import { LoginPage } from '../pages/login-page';
import { MediaSettingsPage } from '../pages/media-settings-page';
import { PrivacyPage } from '../pages/privacy-page';
import { PublicSecurityPage } from '../pages/public-security-page';
import { RecoverPage } from '../pages/recover-page';
import { SecuritySettingsPage } from '../pages/security-settings-page';
import { SettingsPage } from '../pages/settings-page';
import { NativeApp } from '../ui/native/native-app';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [loading, user]);

  if (loading || !user) {
    return (
      <main className="center-state">
        <span className="spinner large" aria-label="Verificando sessão" />
      </main>
    );
  }
  return children;
}

export function App() {
  const platform = useAppPlatform();
  const pathname = usePathname();
  if (platform !== 'web') return <NativeApp platform={platform} />;
  if (pathname === '/invite') return <InvitePage />;
  if (pathname === '/recover') return <RecoverPage />;
  if (pathname === '/privacy') return <PrivacyPage />;
  if (pathname === '/security') return <PublicSecurityPage />;
  if (pathname === '/app')
    return (
      <ProtectedRoute>
        <AppPage />
      </ProtectedRoute>
    );
  if (pathname === '/settings/security')
    return (
      <ProtectedRoute>
        <SecuritySettingsPage />
      </ProtectedRoute>
    );
  if (pathname === '/settings/invites')
    return (
      <ProtectedRoute>
        <InvitesSettingsPage />
      </ProtectedRoute>
    );
  if (pathname === '/settings/media')
    return (
      <ProtectedRoute>
        <MediaSettingsPage />
      </ProtectedRoute>
    );
  if (pathname === '/settings')
    return (
      <ProtectedRoute>
        <SettingsPage />
      </ProtectedRoute>
    );
  return <LoginPage />;
}
