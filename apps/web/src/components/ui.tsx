import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent-strong text-on-accent hover:brightness-95 active:brightness-90 shadow-card',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-surface text-danger border border-line hover:bg-surface-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', block, busy, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-[1rem] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, hint, error, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-[1rem] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
});

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card ${className}`}>{children}</section>;
}

export function Notice({
  tone = 'info',
  role = 'status',
  children,
}: {
  tone?: 'info' | 'error' | 'success';
  role?: 'status' | 'alert';
  children: ReactNode;
}) {
  const styles = {
    info: 'bg-sage-soft text-ink border-sage/40',
    success: 'bg-sage-soft text-ink border-sage/40',
    error: 'bg-surface text-danger border-danger/40',
  }[tone];
  return (
    <div role={role} className={`rounded-xl border px-4 py-3 text-[0.95rem] [overflow-wrap:anywhere] ${styles}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      <h1 className="text-[1.9rem] text-ink">{title}</h1>
      {subtitle && <p className="text-muted">{subtitle}</p>}
    </header>
  );
}

export function VisuallyHidden({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span id={id} className="sr-only">
      {children}
    </span>
  );
}
