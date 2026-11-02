'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { statusLabel, statusTone, type Tone } from '@/lib/format';

const TONE_CLASSES: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  info: 'bg-teal-100 text-teal-600 ring-teal-500/30',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  critical: 'bg-rose-50 text-rose-800 ring-rose-200',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-ivory-100 bg-white p-5 shadow-[0_1px_2px_rgba(11,31,58,0.06)] sm:p-6 ${className}`}
    >
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-navy-900">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const accent =
    tone === 'critical'
      ? 'text-rose-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-navy-900';
  return (
    <div className="rounded-2xl border border-ivory-100 bg-white p-5 shadow-[0_1px_2px_rgba(11,31,58,0.06)]">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${accent}`}>{value}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-navy-900 text-ivory-50 hover:bg-navy-700',
  secondary: 'bg-white text-navy-900 ring-1 ring-inset ring-slate-300 hover:bg-ivory-50',
  danger: 'bg-rose-700 text-white hover:bg-rose-800',
  ghost: 'text-navy-900 hover:bg-ivory-100',
};

export function Button({
  variant = 'primary',
  busy = false,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_CLASSES[variant]} ${className}`}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

const FIELD_CLASSES =
  'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 focus:outline-none';

export function TextField({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm font-medium text-navy-900">
      {label}
      <input {...props} className={FIELD_CLASSES} />
      {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block text-sm font-medium text-navy-900">
      {label}
      <select {...props} className={FIELD_CLASSES}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Alert({
  tone = 'critical',
  children,
}: {
  tone?: 'critical' | 'good' | 'info';
  children: ReactNode;
}) {
  const classes =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'info'
        ? 'border-teal-500/30 bg-teal-100 text-navy-900'
        : 'border-rose-200 bg-rose-50 text-rose-900';
  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${classes}`}
    >
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-sm text-muted">
      <span className="size-5 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ProgressBar({ value, total, label }: { value: number; total: number; label: string }) {
  const percent = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
        className="h-2 w-full overflow-hidden rounded-full bg-ivory-100"
      >
        <div className="h-full rounded-full bg-teal-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">
        {value} of {total} steps
      </p>
    </div>
  );
}
