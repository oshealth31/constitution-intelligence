// Creates (or promotes) a Platform Super Admin.
//
//   pnpm super-admin:create --email you@example.com --name "Your Name"
//
// No password is ever set or printed by this script. It prints a ONE-TIME link
// (valid for PASSWORD_RESET_TTL_MINUTES) that the person uses to choose their own password.
import { z } from 'zod';
import { PlatformService } from '../modules/platform/platform.service';
import { createCliContext, readArgument } from './cli-app';

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
