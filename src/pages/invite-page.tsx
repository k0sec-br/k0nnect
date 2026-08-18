import { useState } from 'react';

import { AsyncButton } from '../components/async-button';
import { FormMessage } from '../components/form-message';
import { PublicLayout } from '../components/public-layout';
import { TurnstileChallenge } from '../components/turnstile-challenge';
import { useAuth } from '../features/auth/auth-context';
import { consumeInviteToken } from '../features/auth/invite-memory';
import { RecoveryCodesCard } from '../features/auth/recovery-codes-card';
import { usePublicConfig } from '../hooks/use-public-config';
import { UserFacingError } from '../lib/api-client';
import { navigate } from '../lib/navigation';

export function InvitePage() {
  const { register } = useAuth();
  const config = usePublicConfig();
  const [inviteToken] = useState(consumeInviteToken);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [challengeRequired, setChallengeRequired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');

  if (recoveryCodes) {
    return (
      <PublicLayout>
        <RecoveryCodesCard codes={recoveryCodes} onContinue={() => navigate('/app')} />
      </PublicLayout>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (displayName.trim().length < 1 || username.trim().length < 3) {
      setError('Preencha seu nome e escolha um usuário com pelo menos 3 caracteres.');
      return;
    }
    if (password.length < 12) {
      setError('Sua senha precisa ter pelo menos 12 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas digitadas não são iguais.');
      return;
    }
    if (!/^[A-Za-z0-9_-]{43}$/u.test(inviteToken)) {
      setError('Este convite não é válido ou não está mais disponível.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const codes = await register({
        inviteToken,
        username,
        displayName,
        password,
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      setRecoveryCodes(codes);
    } catch (caught) {
      if (caught instanceof UserFacingError) {
        setError(caught.message);
        if (caught.code === 'VALIDATION_ERROR' && config?.turnstileEnabled)
          setChallengeRequired(true);
      } else {
        setError('Não foi possível criar sua conta agora. Tente novamente em alguns instantes.');
      }
      setTurnstileToken('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <section className="auth-panel wide" aria-labelledby="invite-title">
        <div className="auth-heading">
          <p className="eyebrow">Convite válido</p>
          <h1 id="invite-title">Você foi convidado para o k0nnect</h1>
          <p>Precisamos apenas do essencial. Nenhum email ou telefone.</p>
        </div>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="form-grid">
            <div>
              <label htmlFor="display-name">Como quer ser chamado</label>
              <input
                id="display-name"
                autoComplete="nickname"
                minLength={1}
                maxLength={40}
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Seu nome na comunidade"
              />
            </div>
            <div>
              <label htmlFor="new-username">Usuário</label>
              <input
                id="new-username"
                autoComplete="username"
                minLength={3}
                maxLength={24}
                pattern="[A-Za-z0-9._-]+"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="seu.usuario"
              />
            </div>
            <div>
              <label htmlFor="new-password">Senha</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="No mínimo 12 caracteres"
              />
            </div>
            <div>
              <label htmlFor="confirm-password">Repita a senha</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Digite a mesma senha"
              />
            </div>
          </div>
          <div className="password-requirements" aria-live="polite">
            <span className={password.length >= 12 ? 'is-valid' : ''}>Mínimo de 12 caracteres</span>
            <span className={password.length > 0 && password === confirmPassword ? 'is-valid' : ''}>
              Senhas iguais
            </span>
          </div>
          {challengeRequired && config?.turnstileSiteKey && (
            <TurnstileChallenge
              siteKey={config.turnstileSiteKey}
              action="register"
              onToken={setTurnstileToken}
            />
          )}
          {error && <FormMessage message={error} />}
          <AsyncButton className="button primary full" type="submit" loading={loading}>
            Criar conta privada
          </AsyncButton>
        </form>
        <p className="privacy-copy">
          Seu convite fica apenas na memória desta página e já foi removido do endereço.
        </p>
      </section>
    </PublicLayout>
  );
}
