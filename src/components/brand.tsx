export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand" aria-label="k0nnect">
      <span className="brand-mark" aria-hidden="true">
        k0
      </span>
      {!compact && <span className="brand-word">k0nnect</span>}
    </span>
  );
}
