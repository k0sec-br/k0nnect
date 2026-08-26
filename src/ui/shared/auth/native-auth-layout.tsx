import type { ReactNode } from 'react';

import { Brand } from '../../../components/brand';

export function NativeAuthLayout({
  children,
  mobile = false,
}: {
  children: ReactNode;
  mobile?: boolean;
}) {
  return (
    <main className={`native-auth-shell ${mobile ? 'native-auth-shell-mobile' : ''}`}>
      <section className="native-auth-card" aria-label="Acesso ao k0nnect">
        <div className="native-auth-brand">
          <Brand />
        </div>
        {children}
      </section>
      <p className="native-auth-security">Sessão protegida pelo k0nnect</p>
    </main>
  );
}
