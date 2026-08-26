import { useState } from 'react';

import { AsyncButton } from '../../../components/async-button';
import { EyeIcon, EyeOffIcon } from '../../../components/icons';
import { FormMessage } from '../../../components/form-message';
import { TurnstileChallenge } from '../../../components/turnstile-challenge';
import { useAuth } from '../../../features/auth/auth-context';
import { usePublicConfig } from '../../../hooks/use-public-config';
import { UserFacingError } from '../../../lib/api-client';
import { handleInternalLink, navigate } from '../../../lib/navigation';

type LoginFailure = 'credentials' | 'network' | 'server' | null;

function loginFailureMessage(failure: LoginFailure, fallback: string): string {
  if (failure === 'credentials') return 'Usuário ou senha incorretos.';
  if (failure === 'network') return 'Não foi possível conectar ao k0nnect.';
  if (failure === 'server') return 'O k0nnect está indisponível no momento.';
  return fallback;
}

export function LoginForm({
  native = false,
  mobile = false,
}: {
  native?: boolean;
  mobile?: boolean;
}) {
  const { login } = useAuth();
  const config = usePublicConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<LoginFailure>(null);
  const [challengeRequired, setChallengeRequired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setFailure(null);
    try {
      await login(username, password, turnstileToken || undefined);
      navigate('/app');
    } catch (caught) {
      if (caught instanceof UserFacingError) {
        const nextFailure: LoginFailure =
          caught.code === 'AUTH_INVALID_CREDENTIALS'
            ? 'credentials'
            : caught.code === 'NETWORK_UNAVAILABLE'
              ? 'network'
              : caught.code === 'INTERNAL_ERROR'
                ? 'server'
                : null;
        setFailure(nextFailure);
        setError(loginFailureMessage(nextFailure, caught.message));
        if (caught.code === 'VALIDATION_ERROR' && config?.turnstileEnabled) {
          setChallengeRequired(true);
        }
      } else {
        setFailure('server');
        setError('O k0nnect está indisponível no momento.');
      }
      setTurnstileToken('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className={native ? 'native-auth-heading' : 'auth-heading'}>
        {!native && <span className="eyebrow">ACESSO SEGURO</span>}
        <h1 id={native ? undefined : 'login-title'}>
          {mobile ? 'Entrar no k0nnect' : 'Bem-vindo de volta'}
        </h1>
        <p>
          {native
            ? 'Entre na sua conta para continuar.'
            : 'Entre com sua conta para acessar conversas, grupos e chamadas.'}
        </p>
      </div>
      <form className="native-login-form" onSubmit={(event) => void submit(event)} noValidate>
        <label htmlFor={native ? 'native-username' : 'username'}>Usuário</label>
        <input
          id={native ? 'native-username' : 'username'}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          minLength={3}
          maxLength={24}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="seu.usuario"
          disabled={loading}
        />
        <div className="label-row">
          <label htmlFor={native ? 'native-password' : 'password'}>Senha</label>
          <a href="/recover" onClick={handleInternalLink}>
            Esqueci minha senha
          </a>
        </div>
        <div className="password-input-wrap">
          <input
            id={native ? 'native-password' : 'password'}
            name="password"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            enterKeyHint="done"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
            disabled={loading}
          />
          <button
            className="password-visibility-button"
            type="button"
            aria-label={passwordVisible ? 'Ocultar caracteres' : 'Exibir caracteres'}
            aria-pressed={passwordVisible}
            title={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'}
            disabled={loading}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </button>
        </div>
        {challengeRequired && config?.turnstileSiteKey && (
          <TurnstileChallenge
            siteKey={config.turnstileSiteKey}
            action="login"
            onToken={setTurnstileToken}
          />
        )}
        {error && <FormMessage message={error} />}
        <AsyncButton className="button primary full" type="submit" loading={loading}>
          {loading ? 'Entrando...' : native ? 'Entrar' : 'Entrar no k0nnect'}
        </AsyncButton>
        {(failure === 'network' || failure === 'server') && (
          <button className="button secondary full" type="button" onClick={() => void submit()}>
            Tentar novamente
          </button>
        )}
      </form>
      {config?.registrationMode === 'invite' && (
        <p className={native ? 'native-auth-invite' : 'auth-note'}>
          Possui um convite? Abra o link recebido neste dispositivo.
        </p>
      )}
    </>
  );
}
