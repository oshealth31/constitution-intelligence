// Runs the housekeeping cleanup once (Task D6). The API also runs it every
// CLEANUP_INTERVAL_HOURS by itself; this is for doing it now, or when the timer is off.
//
//   docker compose run --rm -T api node dist/cli/cleanup.js
import { CleanupService } from '../modules/maintenance/cleanup.service';
import { createCliContext } from './cli-app';

async function main(): Promise<void> {
  const { app } = await createCliContext();
  try {
    const result = await app.get(CleanupService).run();
    console.log(
      result.ran
        ? `Cleanup done: ${result.sessions} ended sessions, ${result.passwordResetLinks} old password-reset links, ${result.rateLimitCounters} old rate-limit counters, ${result.twoStepChallenges} expired two-step challenges removed.`
        : 'Another copy of the API is cleaning up right now; nothing was done.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
