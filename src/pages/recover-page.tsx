import { useState } from 'react';

import { AsyncButton } from '../components/async-button';
import { FormMessage } from '../components/form-message';
import { PublicLayout } from '../components/public-layout';
import { TurnstileChallenge } from '../components/turnstile-challenge';
import type { AppPlatform } from '../core/platform/app-platform';
import { RecoveryCodesCard } from '../features/auth/recovery-codes-card';
import { usePublicConfig } from '../hooks/use-public-config';
import { apiClient, UserFacingError } from '../lib/api-client';
import { handleInternalLink, navigate } from '../lib/navigation';
import { NativeAuthLayout } from '../ui/shared/auth/native-auth-layout';

export function RecoverPage({ nativePlatform }: { nativePlatform?: Exclude<AppPlatform, 'web'> }) {
  const config = usePublicConfig();
  const [username, setUsername] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [challengeRequired, setChallengeRequired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');

  if (codes) {
    const recoveryCodes = <RecoveryCodesCard codes={codes} onContinue={() => navigate('/login')} />;
    return nativePlatform ? (
      <NativeAuthLayout mobile={nativePlatform === 'mobile'}>{recoveryCodes}</NativeAuthLayout>
    ) : (
      <PublicLayout>{recoveryCodes}</PublicLayout>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await apiClient.post<{ recoveryCodes: string[] }>('/api/auth/recover', {
        username,
        recoveryCode: recoveryCode.toUpperCase(),
        newPassword,
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      setCodes(result.recoveryCodes);
    } catch (caught) {
      if (caught instanceof UserFacingError) {
        setError(caught.message);
        if (caught.code === 'VALIDATION_ERROR' && config?.turnstileEnabled)
          setChallengeRequired(true);
      } else {
        setError(
          'Não foi possível recuperar sua conta agora. Tente novamente em alguns instantes.',
        );
      }
      setTurnstileToken('');
    } finally {
      setLoading(false);
    }
  };

  const recoveryForm = (
    <section className="auth-panel" aria-labelledby="recover-title">
      <div className="auth-heading">
        <p className="eyebrow">Recuperação sem email</p>
        <h1 id="recover-title">Recupere sua conta</h1>
        <p>Use um dos códigos que você guardou ao criar a conta.</p>
      </div>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label htmlFor="recover-username">Usuário</label>
        <input
          id="recover-username"
          autoComplete="username"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label htmlFor="recovery-code">Código de recuperação</label>
        <input
          id="recovery-code"
          autoComplete="one-time-code"
          required
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        />
        <label htmlFor="recovery-password">Nova senha</label>
        <input
          id="recovery-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        {challengeRequired && config?.turnstileSiteKey && (
          <TurnstileChallenge
            siteKey={config.turnstileSiteKey}
            action="recover"
            onToken={setTurnstileToken}
          />
        )}
        {error && <FormMessage message={error} />}
        <AsyncButton className="button primary full" type="submit" loading={loading}>
          Redefinir senha
        </AsyncButton>
      </form>
      <a className="back-link" href="/login" onClick={handleInternalLink}>
        Voltar para entrar
      </a>
    </section>
  );
  return nativePlatform ? (
    <NativeAuthLayout mobile={nativePlatform === 'mobile'}>{recoveryForm}</NativeAuthLayout>
  ) : (
    <PublicLayout>{recoveryForm}</PublicLayout>
  );
}
