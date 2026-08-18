import type { ReactNode } from 'react';

import { handleInternalLink } from '../lib/navigation';

export function SettingsLayout({
  children,
  active,
}: {
  children: ReactNode;
  active: 'account' | 'security';
}) {
  return (
    <div className="settings-page">
      <header className="settings-heading">
        <a href="/app" onClick={handleInternalLink}>
          ← Voltar para Geral
        </a>
        <h1>Configurações</h1>
        <p>Controle sua conta sem compartilhar mais dados do que o necessário.</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Configurações">
          <a
            className={active === 'account' ? 'active' : ''}
            href="/settings"
            onClick={handleInternalLink}
          >
            Minha conta
          </a>
          <a
            className={active === 'security' ? 'active' : ''}
            href="/settings/security"
            onClick={handleInternalLink}
          >
            Segurança e sessões
          </a>
        </nav>
        <div className="settings-content">{children}</div>
      </div>
    </div>
  );
}
