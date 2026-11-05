'use client';

import type { ReactNode } from 'react';
import { brandProperties, type BrandColours } from '@/lib/branding';
import { useCssProperties } from '@/lib/css-properties';

/**
 * A wrapper that gives its contents an organisation's colours (as --brand-* CSS variables),
 * without a style="" attribute (Task D13). Outside it, the platform defaults in globals.css
 * apply.
 */
export function BrandScope({
  colours,
  className,
  children,
}: {
  colours: Partial<BrandColours> | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  const ref = useCssProperties<HTMLDivElement>(brandProperties(colours));
  return (
    <div ref={ref} className={className} data-brand-scope="">
      {children}
    </div>
  );
}

/** A filled bar whose width is set without a style="" attribute (Task D13). */
export function WidthBar({ percent, className }: { percent: number; className: string }) {
  const safe = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const ref = useCssProperties<HTMLDivElement>({ '--bar-width': `${safe}%` });
  return <div ref={ref} className={`w-[var(--bar-width)] ${className}`} />;
}
