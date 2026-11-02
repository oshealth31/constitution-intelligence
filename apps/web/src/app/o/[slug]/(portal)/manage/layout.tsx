'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice, PortalHeading, SettingsIcon } from '@/components/portal-ui';
import { portalPath } from '@/lib/portal';
import { usePortal } from '../portal-context';
import { MANAGE_SECTIONS, visibleSections } from './sections';

/**
 * Organisation administrator area. Pages are shown only to people whose role allows them;
 * the API independently refuses every change from anyone else.
 */
export default function ManageLayout({ children }: { children: ReactNode }) {
  const { home, slug } = usePortal();
  const pathname = usePathname();
  const sections = visibleSections(home.you.permissions);
  const current = MANAGE_SECTIONS.find((section) => pathname.endsWith(section.path));

  if (sections.length === 0 || (current && !sections.includes(current))) {
    return (
      <div className="max-w-2xl">
        <PortalHeading icon={<SettingsIcon className="size-6" />} title="Manage" />
        <Notice tone="warning">
          This area is for organisation administrators. Your role ({home.you.roleLabel}) does not
          include it. If you need access, please ask your organisation’s owner.
        </Notice>
      </div>
    );
  }

  return (
    <div>
      <PortalHeading
        icon={<SettingsIcon className="size-6" />}
        title="Manage"
        description={`Settings for ${home.organisation.name}. Changes are recorded in the organisation’s activity log.`}
      />
      {current && (
        <nav aria-label="Manage sections" className="-mx-4 mb-6 overflow-x-auto px-4">
          <ul className="flex gap-2">
            {sections.map((section) => {
              const active = section === current;
              return (
                <li key={section.path} className="shrink-0">
                  <Link
                    href={portalPath(slug, section.path)}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium ring-1 ring-inset ${
                      active
                        ? 'bg-[var(--brand-primary)] text-[var(--brand-on-primary)] ring-transparent'
                        : 'bg-white text-slate-800 ring-slate-300 hover:ring-[var(--brand-accent)]'
                    }`}
                  >
                    {section.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      {children}
    </div>
  );
}
