import { oneLine, renderEmail, type EmailContent } from './templates';

/**
 * The first-password email for a new Platform Super Admin (Task S2). Used by
 * `create-super-admin --send-email` so the one-time link goes to the person's inbox instead of
 * being printed (deployment logs on GitHub are public for this repository).
 */
export function buildSuperAdminSetupEmail(
  displayName: string,
  link: string,
  ttlMinutes: number,
): EmailContent {
  return renderEmail({
    greeting: `Hello ${oneLine(displayName)},`,
    paragraphs: [
      'A Platform Super Admin account has been created for you on Constitution Intelligence.',
      'Use the button below to choose your password. At your first sign-in you will be asked to set up two-step sign-in with an authenticator app.',
    ],
    action: { label: 'Choose your password', url: link },
    afterAction: [
      `The link expires in ${ttlMinutes} minutes and can be used once.`,
      'If you did not expect this email, do not use the link and tell the platform owner.',
    ],
  });
}
