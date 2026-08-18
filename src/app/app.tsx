import { useEffect, type ReactNode } from 'react';

import { AppShell } from '../components/app-shell';
import { useAuth } from '../features/auth/auth-context';
import { navigate, usePathname } from '../lib/navigation';
import { AppPage } from '../pages/app-page';
import { InvitePage } from '../pages/invite-page';
import { LoginPage } from '../pages/login-page';
import { PrivacyPage } from '../pages/privacy-page';
import { PublicSecurityPage } from '../pages/public-security-page';
import { RecoverPage } from '../pages/recover-page';
import { SecuritySettingsPage } from '../pages/security-settings-page';
import { SettingsPage } from '../pages/settings-page';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { loading, logout, user } = useAuth();
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
  return (
    <AppShell user={user} onLogout={() => void logout().then(() => navigate('/login'))}>
      {children}
    </AppShell>
  );
}

export function App() {
  const pathname = usePathname();
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
  if (pathname === '/settings')
    return (
      <ProtectedRoute>
        <SettingsPage />
      </ProtectedRoute>
    );
  return <LoginPage />;
}
