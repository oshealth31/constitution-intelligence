// Fictional data for a load test on a real server (task T3 on the live site).
//
// It only ever works on organisations whose web address starts with "load-test-", which it
// creates itself; it refuses anything else, so real organisations cannot be touched.
//
//   # Create: a fictional organisation, N fictional members (password read from stdin, never
//   # printed or stored anywhere but as a hash) and a very large fictional constitution.
//   printf '%s' "$PASSWORD" | docker compose run --rm -T api node dist/cli/load-test-data.js \
//     --create --members 200
//
//   # Finish: suspend it (members are signed out and blocked) and request its deletion.
//   docker compose run --rm -T api node dist/cli/load-test-data.js --finish
//
//   # Delete (24 hours after --finish, the waiting period of every deletion):
//   docker compose run --rm -T api node dist/cli/load-test-data.js --delete
//
// Output is one line of JSON (ids and counts only: no email address, no password).
import { createCliContext, hasFlag, readArgument } from './cli-app';
import { createLoadTestData, deleteLoadTestData, finishLoadTestData } from './load-test-tasks';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(): Promise<void> {
  const action = ['create', 'finish', 'delete'].find((name) => hasFlag(name));
  if (!action) {
    console.error(
      'Usage: load-test-data.js --create [--members 200] (password on stdin) | --finish | --delete',
    );
    process.exitCode = 1;
    return;
  }
  const members = Number(readArgument('members') ?? 200);
  if (!Number.isInteger(members) || members < 1 || members > 1000) {
    console.error('--members must be a whole number from 1 to 1000.');
    process.exitCode = 1;
    return;
  }
  const { app } = await createCliContext();
  try {
    const result =
      action === 'create'
        ? await createLoadTestData(app, members, await readStdin())
        : action === 'finish'
          ? await finishLoadTestData(app)
          : await deleteLoadTestData(app);
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
