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
        <span className="public-security-label">
          <span aria-hidden="true" /> Privado por padrão
        </span>
      </header>
      <main className="public-main">
        <section className="public-introduction" aria-label="Sobre o k0nnect">
          <span className="technical-label">K0SEC // COMUNICAÇÃO PRIVADA</span>
          <h2>
            Uma sala segura.
            <br />
            Só quem você convidar.
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
