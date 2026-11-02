'use client';

import { ActionTile, SettingsIcon } from '@/components/portal-ui';
import { portalPath } from '@/lib/portal';
import { usePortal } from '../portal-context';
import { visibleSections } from './sections';

export default function ManageHomePage() {
  const { home, slug } = usePortal();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {visibleSections(home.you.permissions).map((section) => (
        <ActionTile
          key={section.path}
          href={portalPath(slug, section.path)}
          icon={<SettingsIcon className="size-6" />}
          title={section.title}
          description={section.description}
        />
      ))}
    </div>
  );
}
