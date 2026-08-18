import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { ErrorBoundary } from './app/error-boundary';
import { AuthProvider } from './features/auth/auth-context';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento principal ausente');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
