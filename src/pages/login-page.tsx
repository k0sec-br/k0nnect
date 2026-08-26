import { useEffect } from 'react';

import { PublicLayout } from '../components/public-layout';
import { useAuth } from '../features/auth/auth-context';
import { navigate } from '../lib/navigation';
import { LoginForm } from '../ui/shared/auth/login-form';

export function LoginPage() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate('/app');
  }, [user]);

  return (
    <PublicLayout>
      <section className="auth-panel" aria-labelledby="login-title">
        <LoginForm />
      </section>
    </PublicLayout>
  );
}
