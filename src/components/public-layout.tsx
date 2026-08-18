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
      </header>
      <main className="public-main">
        <section className="public-introduction" aria-label="Sobre o k0nnect">
          <span className="technical-label">K0SEC // VOZ EM TEMPO REAL</span>
          <h2>
            Converse com sua comunidade.
            <br />
            Só quem tem acesso entra.
          </h2>
          <p>Comunicação de voz sem publicidade, rastreamento ou coleta desnecessária de dados.</p>
          <div className="public-principles" aria-label="Princípios do produto">
            <span>Convites de uso único</span>
            <span>Áudio sem gravação</span>
            <span>Open source</span>
          </div>
        </section>
        <div className="public-content">{children}</div>
      </main>
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
