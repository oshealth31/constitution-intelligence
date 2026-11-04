// Removes one person's two-step sign-in from the server command line, for when they lost their
// phone AND their recovery codes AND no other Super Admin can reset it in the Control Centre
// (for example the only Super Admin). It also signs them out everywhere. Audited, and the
// person is told by email.
//
//   docker compose run --rm -T api node dist/cli/reset-two-step.js \
//     --email named.person@example.com --reason "Lost phone; identity confirmed by phone call"
//
// Only someone with access to the server can run it. Confirm who is asking before you do.
import { z } from 'zod';
import { TwoStepService } from '../modules/auth/two-step.service';
import { createCliContext, readArgument } from './cli-app';

async function main(): Promise<void> {
  const email = z.email().safeParse(readArgument('email')?.trim().toLowerCase());
  const reason = readArgument('reason')?.trim() ?? '';
  if (!email.success || reason.length < 10) {
    console.error(
      'Usage: node dist/cli/reset-two-step.js --email person@example.com --reason "why (at least 10 characters)"',
    );
    process.exitCode = 1;
    return;
  }

  const { app } = await createCliContext();
  try {
    const result = await app
      .get(TwoStepService)
      .reset(email.data, null, reason, { ipAddress: null, userAgent: 'cli', requestId: null });
    console.log(
      [
        '',
        `Two-step sign-in removed for ${email.data}; ${result.sessionsRevoked} session(s) signed out.`,
        'They can now sign in with their password and set up two-step sign-in again.',
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
