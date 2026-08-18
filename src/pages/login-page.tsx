import { useEffect, useState } from 'react';

import { AsyncButton } from '../components/async-button';
import { FormMessage } from '../components/form-message';
import { PublicLayout } from '../components/public-layout';
import { TurnstileChallenge } from '../components/turnstile-challenge';
import { useAuth } from '../features/auth/auth-context';
import { UserFacingError } from '../lib/api-client';
import { handleInternalLink, navigate } from '../lib/navigation';
import { usePublicConfig } from '../hooks/use-public-config';

export function LoginPage() {
  const { login, user } = useAuth();
  const config = usePublicConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [challengeRequired, setChallengeRequired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');

  useEffect(() => {
    if (user) navigate('/app');
  }, [user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(username, password, turnstileToken || undefined);
      navigate('/app');
    } catch (caught) {
      if (caught instanceof UserFacingError) {
        setError(caught.message);
        if (caught.code === 'VALIDATION_ERROR' && config?.turnstileEnabled)
          setChallengeRequired(true);
      } else {
        setError('Não foi possível entrar agora. Tente novamente em alguns instantes.');
      }
      setTurnstileToken('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-heading">
          <p className="eyebrow">Acesso à comunidade</p>
          <h1 id="login-title">Bem-vindo de volta</h1>
          <p>Entre para conversar com sua comunidade em tempo real.</p>
        </div>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="username">Usuário</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            minLength={3}
            maxLength={24}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="seu.usuario"
          />
          <div className="label-row">
            <label htmlFor="password">Senha</label>
            <a href="/recover" onClick={handleInternalLink}>
              Esqueci minha senha
            </a>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
          />
          {challengeRequired && config?.turnstileSiteKey && (
            <TurnstileChallenge
              siteKey={config.turnstileSiteKey}
              action="login"
              onToken={setTurnstileToken}
            />
          )}
          {error && <FormMessage message={error} />}
          <AsyncButton className="button primary full" type="submit" loading={loading}>
            Entrar no k0nnect
          </AsyncButton>
        </form>
        <p className="auth-note">
          O cadastro é exclusivo por convite. Peça um link a um administrador da sua comunidade.
        </p>
      </section>
    </PublicLayout>
  );
}
