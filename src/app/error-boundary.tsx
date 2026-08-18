import { Component, type ReactNode } from 'react';

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <main className="fatal-state">
          <div className="brand-mark">k0</div>
          <h1>Algo não saiu como esperado</h1>
          <p>O k0nnect não conseguiu abrir esta tela. Recarregue a página para tentar novamente.</p>
          <button className="button primary" type="button" onClick={() => window.location.reload()}>
            Recarregar página
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
