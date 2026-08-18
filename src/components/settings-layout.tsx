import type { ReactNode } from 'react';

import { useAuth } from '../features/auth/auth-context';
import { handleInternalLink, navigate } from '../lib/navigation';
import { Avatar } from './avatar';
import { Brand } from './brand';
import { ExitIcon, ShieldIcon } from './icons';

export function SettingsLayout({
  children,
  active,
}: {
  children: ReactNode;
  active: 'account' | 'security';
}) {
  const { logout, user } = useAuth();
  if (!user) return null;

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <a className="settings-brand" href="/app" onClick={handleInternalLink}>
          <Brand />
        </a>
        <nav className="settings-nav" aria-label="Configurações">
          <span className="settings-nav-label">Configurações do usuário</span>
          <a
            className={active === 'account' ? 'active' : ''}
            href="/settings"
            onClick={handleInternalLink}
            aria-current={active === 'account' ? 'page' : undefined}
          >
            Minha conta
          </a>
          <a
            className={active === 'security' ? 'active' : ''}
            href="/settings/security"
            onClick={handleInternalLink}
            aria-current={active === 'security' ? 'page' : undefined}
          >
            <ShieldIcon aria-hidden="true" /> Segurança e sessões
          </a>
        </nav>
        <div className="settings-sidebar-footer">
          <div className="settings-user">
            <Avatar displayName={user.displayName} size="small" />
            <span>
              <strong>{user.displayName}</strong>
              <small>@{user.username}</small>
            </span>
          </div>
          <button type="button" onClick={() => void logout().then(() => navigate('/login'))}>
            <ExitIcon aria-hidden="true" /> Sair
          </button>
        </div>
      </aside>
      <main className="settings-main">
        <header className="settings-main-header">
          <a href="/app" onClick={handleInternalLink} aria-label="Fechar configurações">
            <span aria-hidden="true">×</span>
            <small>ESC</small>
          </a>
        </header>
        <div className="settings-content">
          <header className="settings-heading">
            <span className="technical-label">K0NNECT // SETTINGS</span>
            <h1>Configurações</h1>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
