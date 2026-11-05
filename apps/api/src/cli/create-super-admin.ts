// Creates (or promotes) a Platform Super Admin.
//
//   pnpm super-admin:create --email you@example.com --name "Your Name"
//
// No password is ever set or printed by this script. It prints a ONE-TIME link
// (valid for PASSWORD_RESET_TTL_MINUTES) that the person uses to choose their own password.
//
// With --send-email the link is emailed to the person instead and NOT printed (Task S2: the
// deployment workflow's logs are public). The command fails if the email cannot be sent.
import { z } from 'zod';
import { MailService } from '../modules/mail/mail.service';
import { buildSuperAdminSetupEmail } from '../modules/mail/super-admin-email';
import { PlatformService } from '../modules/platform/platform.service';
import { createCliContext, hasFlag, readArgument } from './cli-app';

async function main(): Promise<void> {
  const email = z.email().safeParse(readArgument('email')?.trim().toLowerCase());
  const name = readArgument('name')?.trim() || 'Platform Administrator';
  if (!email.success) {
    console.error('Usage: pnpm super-admin:create --email you@example.com --name "Your Name"');
    process.exitCode = 1;
    return;
  }

  const { app, config } = await createCliContext();
  try {
    const result = await app.get(PlatformService).bootstrapSuperAdmin(email.data, name);
    if (hasFlag('send-email')) {
      const sent = await app.get(MailService).send({
        to: result.user.email,
        subject: 'Your Constitution Intelligence administrator account',
        ...buildSuperAdminSetupEmail(
          result.user.displayName,
          result.setupLink,
          config.PASSWORD_RESET_TTL_MINUTES,
        ),
      });
      console.log(
        result.created ? 'Created Platform Super Admin.' : 'Granted Platform Super Admin.',
      );
      if (!sent) {
        console.error(
          'The setup email could not be sent. Check the email settings, then run again.',
        );
        process.exitCode = 1;
        return;
      }
      console.log('A one-time setup link was emailed to the person. It is not shown here.');
      return;
    }
    console.log(
      [
        '',
        result.created
          ? `Created Platform Super Admin: ${result.user.email}`
          : `Granted Platform Super Admin to existing account: ${result.user.email}`,
        '',
        `One-time password setup link (expires in ${config.PASSWORD_RESET_TTL_MINUTES} minutes):`,
        result.setupLink,
        '',
        'Until the web sign-in screens exist, the password can be set by sending the token from',
        'that link to POST /api/v1/auth/password/reset (see docs/security/authentication.md).',
        'Do not share this link. Anyone holding it can set the password once.',
        '',
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
