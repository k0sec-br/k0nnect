export function NativeUpdateNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="native-update-notice" role="status">
      {message}
    </div>
  );
}
