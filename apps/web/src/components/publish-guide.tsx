'use client';

import { useEffect, useState } from 'react';
import type { PublishGuide } from '@/lib/publish-guide';
import { WidthBar } from './brand-scope';
import { PortalButton } from './portal-ui';

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Scrolls an element into view and moves keyboard focus to it. */
export function scrollToElement(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  element.focus({ preventScroll: true });
}

/**
 * "Your progress": the five steps from upload to publishing, a progress bar, what to do now,
 * and a button that jumps to the place on the page where it is done.
 */
export function PublishGuidePanel({ guide, onGo }: { guide: PublishGuide; onGo: () => void }) {
  const total = guide.steps.length;
  const finished = guide.percent === 100;
  return (
    <section
      aria-labelledby="publish-guide-title"
      className="rounded-2xl border-2 border-[var(--brand-primary)] bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="publish-guide-title" className="text-base font-semibold text-slate-900">
          {finished ? 'Published' : `Step ${guide.stepNumber} of ${total}`}
        </h3>
        <span className="text-sm font-semibold text-slate-700">{guide.percent}% done</span>
      </div>
      <div
        role="progressbar"
        aria-label="Progress towards publishing"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={guide.percent}
        aria-valuetext={`${guide.percent}% done, step ${Math.min(guide.stepNumber, total)} of ${total}`}
        className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <WidthBar
          percent={guide.percent}
          className={`h-full rounded-full transition-[width] duration-500 ${finished ? 'bg-emerald-600' : 'bg-[var(--brand-primary)]'}`}
        />
      </div>

      <ol aria-label="Steps to publish" className="mt-3 grid grid-cols-5 gap-1 text-center">
        {guide.steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="flex flex-col items-center gap-1"
          >
            <span
              aria-hidden="true"
              className={`flex size-7 items-center justify-center rounded-full text-sm font-bold ${
                step.state === 'done'
                  ? 'bg-emerald-600 text-white'
                  : step.state === 'current'
                    ? 'bg-[var(--brand-primary)] text-[var(--brand-on-primary)] ring-4 ring-[var(--brand-accent)]'
                    : 'bg-slate-200 text-slate-600'
              }`}
            >
              {step.state === 'done' ? '✓' : index + 1}
            </span>
            <span
              className={`text-xs leading-tight ${step.state === 'current' ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
            >
              {step.label}
              <span className="sr-only">
                {step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (now)' : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div
        className={`mt-4 rounded-xl p-4 ${guide.waiting ? 'bg-slate-50' : finished ? 'bg-emerald-50' : 'bg-[var(--brand-secondary)]'}`}
      >
        <p className="text-base font-semibold text-slate-900">
          {finished ? '' : 'Now: '}
          {guide.title}
        </p>
        <p className="mt-1 text-base text-slate-800">{guide.text}</p>
        {guide.targetLabel && (
          <PortalButton type="button" className="mt-3 w-full sm:w-auto" onClick={onGo}>
            {guide.targetLabel} ↓
          </PortalButton>
        )}
      </div>
    </section>
  );
}

/** A round button that appears after scrolling down and takes the person back to the top. */
export function BackToTop({ focusId }: { focusId?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > 400);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => {
        window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
      }}
      className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--brand-primary)] px-4 text-base font-semibold text-[var(--brand-on-primary)] shadow-lg ring-2 ring-white hover:opacity-90 focus-visible:ring-4 focus-visible:ring-[var(--brand-accent)] focus-visible:outline-none md:bottom-6"
    >
      <span aria-hidden="true">↑</span> Back to top
    </button>
  );
}
