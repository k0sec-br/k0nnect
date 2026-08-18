import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

import { useAuth } from '../features/auth/auth-context';
import { handleInternalLink, navigate } from '../lib/navigation';
import { Avatar } from './avatar';
import { Brand } from './brand';
import { SettingsCallBar } from './settings-call-bar';
import {
  CameraIcon,
  ChevronRightIcon,
  CloseIcon,
  ExitIcon,
  KeyIcon,
  MenuIcon,
  ShieldIcon,
  UserIcon,
} from './icons';

type SettingsArea = 'account' | 'invites' | 'media' | 'security';

function SettingsNavItem({
  active,
  children,
  href,
  icon,
  onNavigate,
}: {
  active: boolean;
  children: ReactNode;
  href: string;
  icon: ReactNode;
  onNavigate(event: MouseEvent<HTMLAnchorElement>): void;
}) {
  return (
    <a
      className={active ? 'active' : ''}
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span>{children}</span>
      <ChevronRightIcon className="settings-nav-chevron" aria-hidden="true" />
    </a>
  );
}

export function SettingsLayout({
  children,
  active,
}: {
  children: ReactNode;
  active: SettingsArea;
}) {
  const { logout, user } = useAuth();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (mobileNavigationOpen) {
        setMobileNavigationOpen(false);
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-settings-dialog]')) return;
      navigate('/app');
    };
    document.addEventListener('keydown', closeWithEscape);
    return () => document.removeEventListener('keydown', closeWithEscape);
  }, [mobileNavigationOpen]);

  if (!user) return null;

  const handleSettingsLink = (event: MouseEvent<HTMLAnchorElement>) => {
    handleInternalLink(event);
    setMobileNavigationOpen(false);
  };

  return (
    <div className="settings-shell">
      <button
        className={`settings-sidebar-backdrop ${mobileNavigationOpen ? 'is-visible' : ''}`}
        type="button"
        aria-label="Fechar menu de configurações"
        aria-hidden={!mobileNavigationOpen}
        tabIndex={mobileNavigationOpen ? 0 : -1}
        onClick={() => setMobileNavigationOpen(false)}
      />
      <aside
        id="settings-navigation"
        className={`settings-sidebar ${mobileNavigationOpen ? 'is-mobile-open' : ''}`}
      >
        <a className="settings-brand" href="/app" onClick={handleInternalLink}>
          <Brand />
        </a>
        <nav className="settings-nav" aria-label="Configurações">
          <div className="settings-nav-section">
            <span className="settings-nav-label">Conta</span>
            <SettingsNavItem
              active={active === 'account'}
              href="/settings"
              icon={<UserIcon aria-hidden="true" />}
              onNavigate={handleSettingsLink}
            >
              Minha conta
            </SettingsNavItem>
            <SettingsNavItem
              active={active === 'media'}
              href="/settings/media"
              icon={<CameraIcon aria-hidden="true" />}
              onNavigate={handleSettingsLink}
            >
              Voz e vídeo
            </SettingsNavItem>
            <SettingsNavItem
              active={active === 'security'}
              href="/settings/security"
              icon={<ShieldIcon aria-hidden="true" />}
              onNavigate={handleSettingsLink}
            >
              Segurança e sessões
            </SettingsNavItem>
          </div>
          {user.role !== 'member' && (
            <div className="settings-nav-section">
              <span className="settings-nav-label">Administração</span>
              <SettingsNavItem
                active={active === 'invites'}
                href="/settings/invites"
                icon={<KeyIcon aria-hidden="true" />}
                onNavigate={handleSettingsLink}
              >
                Convites
              </SettingsNavItem>
            </div>
          )}
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
          <button
            className="settings-mobile-menu"
            type="button"
            aria-controls="settings-navigation"
            aria-expanded={mobileNavigationOpen}
            onClick={() => setMobileNavigationOpen(true)}
          >
            <MenuIcon aria-hidden="true" />
            Configurações
          </button>
          <a
            className="settings-close"
            href="/app"
            onClick={handleInternalLink}
            aria-label="Fechar configurações"
            data-tooltip="Fechar configurações"
          >
            <CloseIcon aria-hidden="true" />
            <small aria-hidden="true">ESC</small>
          </a>
        </header>
        <div className="settings-content">
          <header className="settings-heading">
            <span className="technical-label">K0NNECT // SETTINGS</span>
            <h1>Configurações</h1>
            <p>Gerencie sua conta, dispositivos e segurança.</p>
          </header>
          {children}
        </div>
      </main>
      <SettingsCallBar />
    </div>
  );
}
