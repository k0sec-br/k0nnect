import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function AsyncButton({
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading: boolean; children: ReactNode }) {
  return (
    <button {...props} disabled={loading || props.disabled}>
      {loading && <span className="spinner" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}
