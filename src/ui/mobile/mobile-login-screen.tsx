import { LoginForm } from '../shared/auth/login-form';
import { NativeAuthLayout } from '../shared/auth/native-auth-layout';

export function MobileLoginScreen() {
  return (
    <NativeAuthLayout mobile>
      <LoginForm native mobile />
    </NativeAuthLayout>
  );
}
