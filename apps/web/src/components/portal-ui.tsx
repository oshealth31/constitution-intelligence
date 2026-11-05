'use client';

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, SVGProps } from 'react';
import { initials } from '@/lib/branding';
import { highlightTerms } from '@/lib/portal';

/**
 * Building blocks for organisation portals. Colours come from the CSS variables set by
 * brandProperties() via <BrandScope> (see lib/branding.ts), so the same components show each organisation's look.
 */

// ----- Icons (simple outlines; always shown together with a text label) ----------------------

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
  </Icon>
);
export const BookIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    <path d="M8 7h8M8 11h6" />
  </Icon>
);
export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20.5 20.5-4.5-4.5" />
  </Icon>
);
export const ChatIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M8 9h8M8 12h5" />
  </Icon>
);
export const UserIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Icon>
);
export const SettingsIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Icon>
);
export const ListIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </Icon>
);
export const ArrowLeftIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);
export const ChevronRightIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);
export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

// ----- Organisation logo ---------------------------------------------------------------------

/**
 * The organisation's logo, or its initials when it has none. Logos are only ever shown with
 * an <img> tag from our own API (which serves checked PNG/JPEG/WebP files), so they cannot run code.
 */
/** Fixed sizes (no style="" attribute, Task D13): pixels → classes for the box and initials. */
const LOGO_SIZES = {
  32: 'size-8 text-xs',
  40: 'size-10 text-[15px]',
  56: 'size-14 text-[21px]',
  72: 'size-[72px] text-[27px]',
} as const;

export function OrganisationLogo({
  name,
  logoUrl,
  size = 40,
}: {
  name: string;
  logoUrl: string | null;
  size?: keyof typeof LOGO_SIZES;
}) {
  const sizeClass = LOGO_SIZES[size];
  const safeUrl = logoUrl && logoUrl.startsWith('/api/v1/portal/') ? logoUrl : null;
  if (safeUrl) {
    return (
      <img
        src={safeUrl}
        alt={`${name} logo`}
        width={size}
        height={size}
        className={`shrink-0 rounded-full bg-white object-contain ${sizeClass}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--brand-accent)] font-semibold text-[var(--brand-on-accent)] ${sizeClass}`}
    >
      {initials(name)}
    </span>
  );
}

// ----- Buttons and links ---------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'quiet';
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--brand-primary)] text-[var(--brand-on-primary)] shadow-sm hover:brightness-110',
  secondary: 'bg-white text-[var(--brand-ink)] ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  quiet: 'text-[var(--brand-ink)] hover:bg-black/5',
};
const BASE =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';

export function PortalButton({
  variant = 'primary',
  busy = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
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

export function PortalLink({
  href,
  variant = 'primary',
  className = '',
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant }) {
  return (
    <Link href={href} {...props} className={`${BASE} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg pr-3 text-base font-medium text-[var(--brand-ink)] hover:underline"
    >
      <ArrowLeftIcon className="size-5" />
      {children}
    </Link>
  );
}

// ----- Page structure ------------------------------------------------------------------------

export function PortalHeading({
  title,
  description,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        {icon && (
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-secondary)] text-[var(--brand-ink)]">
            {icon}
          </span>
        )}
        {title}
      </h1>
      {description && <p className="mt-2 max-w-2xl text-base text-slate-600">{description}</p>}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:p-6 ${className}`}
    >
      {title && <h2 className="text-lg font-semibold text-slate-900">{title}</h2>}
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className={title || description ? 'mt-4' : ''}>{children}</div>
    </section>
  );
}

/** A big, easy-to-tap card that links somewhere, with an icon and a short explanation. */
export function ActionTile({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-24 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-[var(--brand-accent)] hover:shadow-md"
    >
      <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-[var(--brand-on-primary)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-sm text-slate-600">{description}</span>
      </span>
      <ChevronRightIcon className="size-6 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[var(--brand-ink)]" />
    </Link>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  children: ReactNode;
}) {
  const classes = {
    info: 'border-slate-200 bg-slate-50 text-slate-800',
    warning: 'border-amber-300 bg-amber-50 text-amber-950',
    error: 'border-rose-300 bg-rose-50 text-rose-950',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-base ${classes}`}
    >
      {children}
    </div>
  );
}

export function PortalLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-12 text-base text-slate-600">
      <span className="size-6 animate-spin rounded-full border-[3px] border-[var(--brand-accent)] border-t-transparent" />
      {label}
    </div>
  );
}

/**
 * Shows text with search terms marked. The words are exactly as stored; only <mark> tags are
 * added around matches, and everything is rendered as text (never as HTML).
 */
export function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightTerms(text, terms).map((part, index) =>
        part.highlight ? (
          <mark
            key={index}
            className="rounded bg-[var(--brand-accent)] px-0.5 text-[var(--brand-on-accent)]"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
