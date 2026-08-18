export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand" aria-label="k0nnect">
      <span className="brand-mark" aria-hidden="true">
        <img src="/brand/k0sec-logo.png" alt="" />
      </span>
      {!compact && <span className="brand-word">k0nnect</span>}
    </span>
  );
}
