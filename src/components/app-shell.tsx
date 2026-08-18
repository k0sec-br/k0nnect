import type { ReactNode } from 'react';

import type { SessionUser } from '../../shared/types/api';
import { Brand } from './brand';
import { ExitIcon, SettingsIcon, VolumeIcon } from './icons';
import { handleInternalLink } from '../lib/navigation';

function initials(displayName: string): string {
  return displayName
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppShell({
  children,
  user,
  onLogout,
}: {
  children: ReactNode;
  user: SessionUser;
  onLogout(): void;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="sidebar-brand" href="/app" onClick={handleInternalLink} aria-label="k0nnect">
          <Brand />
        </a>
        <div className="community-card">
          <span className="community-mark" aria-hidden="true">
            K0
          </span>
          <div>
            <strong>Comunidade k0nnect</strong>
            <span>espaço privado</span>
          </div>
        </div>
        <nav className="room-navigation" aria-label="Salas">
          <p>Voz</p>
          <a
            className="room-link active"
            href="/app"
            onClick={handleInternalLink}
            aria-current="page"
          >
            <VolumeIcon aria-hidden="true" />
            Geral
            <span className="live-dot" aria-label="Sala disponível" />
          </a>
        </nav>
        <div className="sidebar-spacer" />
        <div className="user-card">
          <span className="avatar" aria-hidden="true">
            {initials(user.displayName)}
          </span>
          <div className="user-card-copy">
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
          </div>
          <a href="/settings" onClick={handleInternalLink} aria-label="Abrir configurações">
            <SettingsIcon aria-hidden="true" />
          </a>
          <button type="button" onClick={onLogout} aria-label="Sair da conta">
            <ExitIcon aria-hidden="true" />
          </button>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
