export function FormMessage({
  message,
  tone = 'error',
}: {
  message: string;
  tone?: 'error' | 'success';
}) {
  return (
    <p className={`form-message ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </p>
  );
}
