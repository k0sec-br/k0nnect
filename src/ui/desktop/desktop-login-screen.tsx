import { LoginForm } from '../shared/auth/login-form';
import { NativeAuthLayout } from '../shared/auth/native-auth-layout';

export function DesktopLoginScreen() {
  return (
    <NativeAuthLayout>
      <LoginForm native />
    </NativeAuthLayout>
  );
}
