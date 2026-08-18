import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function IconButton({
  label,
  children,
  tone = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      {...props}
      className={`icon-button ${tone === 'danger' ? 'icon-button-danger' : ''} ${props.className ?? ''}`}
      type={props.type ?? 'button'}
      aria-label={label}
      data-tooltip={label}
    >
      {children}
    </button>
  );
}
