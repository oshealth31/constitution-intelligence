// Server command line for personal data requests (Task D11), a backup for the Control Centre.
// The request must already be RECORDED in the Control Centre (who asked, when, how their
// identity was confirmed). From here a copy can be produced, or a deletion carried out.
//
//   docker compose run --rm -T api node dist/cli/data-request.js --request <id> --show
//   docker compose run --rm -T api node dist/cli/data-request.js --request <id> --copy > copy.json
//   docker compose run --rm -T api node dist/cli/data-request.js --request <id> --delete \
//     --confirm <their email> --reason "<why>"
//
// Take a backup first for a deletion (docs/operations/backup-and-restore.md).
import { z } from 'zod';
import { DataRequestsService } from '../modules/platform/data-requests.service';
import { createCliContext, readArgument } from './cli-app';

const USAGE = [
  'Usage: node dist/cli/data-request.js --request <id> --show',
  '       node dist/cli/data-request.js --request <id> --copy > copy.json',
  '       node dist/cli/data-request.js --request <id> --delete --confirm <email> --reason "<why>"',
].join('\n');

const META = { ipAddress: null, userAgent: 'cli', requestId: null };

async function main(): Promise<void> {
  const requestId = z.uuid().safeParse(readArgument('request'));
  const action = ['--show', '--copy', '--delete'].find((flag) => process.argv.includes(flag));
  if (!requestId.success || !action) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const { app } = await createCliContext();
  try {
    const service = app.get(DataRequestsService);
    if (action === '--show') {
      console.log(JSON.stringify(await service.get(requestId.data), null, 2));
      return;
    }
    if (action === '--copy') {
      const { content } = await service.copy(requestId.data, null, META);
      process.stdout.write(content + '\n');
      return;
    }
    const reason = readArgument('reason') ?? '';
    if (reason.trim().length < 10) {
      console.error('Give --reason "<why>" in at least 10 characters.');
      process.exitCode = 1;
      return;
    }
    const result = await service.deletePerson(
      requestId.data,
      readArgument('confirm') ?? '',
      reason.trim(),
      null,
      META,
    );
    console.log(
      [
        '',
        'The account was deleted and its audit entries anonymised.',
        `Counts: ${JSON.stringify(result.request.outcome ?? {})}`,
        'The data remains in backups until they expire (35 days by default).',
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
