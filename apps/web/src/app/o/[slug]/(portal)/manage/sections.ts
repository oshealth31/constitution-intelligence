import { can } from '@/lib/portal';

/** The parts of the Manage area, and the permission each one needs (checked again by the API). */
export const MANAGE_SECTIONS = [
  {
    path: '/manage/branding',
    title: 'Branding',
    description: 'Name, logo, colours and welcome message.',
    permission: 'branding.manage',
  },
  {
    path: '/manage/members',
    title: 'Members',
    description: 'Who can use the portal, and invitations.',
    permission: 'members.read',
  },
  {
    path: '/manage/content',
    title: 'Documents',
    description: 'Upload constitutions, check the text, approve and publish versions.',
    permission: 'content.review',
  },
  {
    path: '/manage/address',
    title: 'Portal address',
    description: 'The web address members use to reach this portal.',
    permission: 'organisation.settings.manage',
  },
] as const;

export function visibleSections(permissions: readonly string[]) {
  return MANAGE_SECTIONS.filter((section) => can(permissions, section.permission));
}
