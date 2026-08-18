import { useEffect, useState } from 'react';

import type { SessionView } from '../../shared/types/api';
import { AsyncButton } from '../components/async-button';
import { FormMessage } from '../components/form-message';
import { SettingsLayout } from '../components/settings-layout';
import { useAuth } from '../features/auth/auth-context';
import { RecoveryCodesCard } from '../features/auth/recovery-codes-card';
import { apiClient, UserFacingError } from '../lib/api-client';
import { navigate } from '../lib/navigation';

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function SecuritySettingsPage() {
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  useEffect(() => {
    apiClient
      .get<{ sessions: SessionView[] }>('/api/auth/sessions')
      .then((result) => setSessions(result.sessions))
      .catch(() => setError('Não foi possível carregar as sessões agora.'));
  }, []);

  const regenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await apiClient.post<{ recoveryCodes: string[]; csrfToken: string }>(
        '/api/auth/recovery-codes/regenerate',
        { password },
      );
      apiClient.setCsrfToken(result.csrfToken);
      setPassword('');
      setRecoveryCodes(result.recoveryCodes);
    } catch (caught) {
      setError(
        caught instanceof UserFacingError
          ? caught.message
          : 'Não foi possível gerar novos códigos.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (recoveryCodes) {
    return (
      <SettingsLayout active="security">
        <RecoveryCodesCard codes={recoveryCodes} onContinue={() => setRecoveryCodes(null)} />
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout active="security">
      <section className="settings-section" aria-labelledby="sessions-title">
        <header className="settings-section-header">
          <span className="eyebrow">Acesso</span>
          <h2 id="sessions-title">Sessões ativas</h2>
          <p>Revise os acessos associados à sua conta.</p>
        </header>
        <div className="session-list">
          {sessions.map((session) => (
            <article key={session.id}>
              <div>
                <strong>{session.current ? 'Esta sessão' : 'Outra sessão'}</strong>
                <span>
                  Ativa em {dateTime(session.lastSeenAt)} · expira em {dateTime(session.expiresAt)}
                </span>
              </div>
              {session.current && <span className="status-chip available">Atual</span>}
            </article>
          ))}
        </div>
        <button
          className="button danger-outline"
          type="button"
          onClick={() => void logout(true).then(() => navigate('/login'))}
        >
          Sair de todas as sessões
        </button>
      </section>
      <section className="settings-section" aria-labelledby="codes-title">
        <header className="settings-section-header">
          <span className="eyebrow">Recuperação</span>
          <h2 id="codes-title">Gerar novos códigos</h2>
          <p>Os códigos atuais deixarão de funcionar. Confirme sua senha para continuar.</p>
        </header>
        <form onSubmit={(event) => void regenerate(event)}>
          <label htmlFor="reauth-password">Senha atual</label>
          <input
            id="reauth-password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <FormMessage message={error} />}
          <AsyncButton className="button secondary" type="submit" loading={loading}>
            Gerar novos códigos
          </AsyncButton>
        </form>
      </section>
    </SettingsLayout>
  );
}
