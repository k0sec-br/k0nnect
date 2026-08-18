import type { ReactNode } from 'react';

import { Brand } from './brand';
import { handleInternalLink } from '../lib/navigation';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <a href="/login" onClick={handleInternalLink} aria-label="Ir para o início">
          <Brand />
        </a>
        <span className="privacy-pill">
          <span aria-hidden="true" /> privado por padrão
        </span>
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-footer">
        <span>© 2026 K0Sec · AGPL-3.0</span>
        <nav aria-label="Links institucionais">
          <a href="/privacy" onClick={handleInternalLink}>
            Privacidade
          </a>
          <a href="/security" onClick={handleInternalLink}>
            Segurança
          </a>
        </nav>
      </footer>
    </div>
  );
}
