// Server command line for organisation deletion (Task D3), a backup for the Control Centre.
// A deletion must still be REQUESTED in the Control Centre (with the reason and the export
// confirmation); from here it can be confirmed only 24 hours after the request.
//
//   docker compose run --rm -T api node dist/cli/delete-organisation.js --organisation <id> --preview
//   docker compose run --rm -T api node dist/cli/delete-organisation.js --organisation <id> \
//     --approve --confirm <web address>
//   docker compose run --rm -T api node dist/cli/delete-organisation.js --organisation <id> --remove-files
//
// Take a backup first (docs/operations/backup-and-restore.md).
import { z } from 'zod';
import { OrganisationDeletionService } from '../modules/platform/organisation-deletion.service';
import { createCliContext, readArgument } from './cli-app';

const USAGE = [
  'Usage: node dist/cli/delete-organisation.js --organisation <id> --preview',
  '       node dist/cli/delete-organisation.js --organisation <id> --approve --confirm <web address>',
  '       node dist/cli/delete-organisation.js --organisation <id> --remove-files',
].join('\n');

async function main(): Promise<void> {
  const organisationId = z.uuid().safeParse(readArgument('organisation'));
  const action = ['--preview', '--approve', '--remove-files'].find((flag) =>
    process.argv.includes(flag),
  );
  if (!organisationId.success || !action) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const { app } = await createCliContext();
  try {
    const deletion = app.get(OrganisationDeletionService);
    if (action === '--preview') {
      console.log(JSON.stringify(await deletion.preview(organisationId.data), null, 2));
      return;
    }
    if (action === '--remove-files') {
      const removed = await deletion.removeFiles(organisationId.data);
      console.log(
        removed ? 'Files removed.' : 'Removing the files failed; see the log and try again.',
      );
      if (!removed) process.exitCode = 1;
      return;
    }
    const confirm = readArgument('confirm') ?? '';
    const preview = await deletion.preview(organisationId.data);
    if (!preview.request) {
      console.error(
        'There is no waiting deletion request. Request it in the Control Centre first.',
      );
      process.exitCode = 1;
      return;
    }
    const result = await deletion.approve(organisationId.data, preview.request.id, confirm, null, {
      ipAddress: null,
      userAgent: 'cli',
      requestId: null,
    });
    console.log(
      [
        '',
        `Deleted the data of "${result.preview.organisation.name}".`,
        `Counts: ${JSON.stringify(result.preview.lastCompleted?.deletedCounts ?? {})}`,
        result.filesRemoved
          ? 'Files removed from storage.'
          : 'Files were NOT removed: run again with --remove-files.',
        'Invoices, payments, receipts and the subscription history were kept.',
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
