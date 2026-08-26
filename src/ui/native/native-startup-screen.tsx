import { Brand } from '../../components/brand';

export function NativeStartupScreen({ message }: { message: string }) {
  return (
    <main className="native-startup-screen" aria-live="polite" aria-busy="true">
      <Brand />
      <span className="spinner large" aria-hidden="true" />
      <p>{message}</p>
    </main>
  );
}
