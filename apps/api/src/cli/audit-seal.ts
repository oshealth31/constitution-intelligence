// Tamper-evident audit log (Task D12). Run daily by the constitution-audit-seal timer
// (infra/production/systemd); see docs/operations/audit-seal.md.
//
//   node dist/cli/audit-seal.js --generate-key            # print a new signing key (keep it secret)
//   node dist/cli/audit-seal.js --public-key              # print the public key and its fingerprint
//   node dist/cli/audit-seal.js --seal                    # seal new entries into AUDIT_SEAL_DIR
//   node dist/cli/audit-seal.js --check --dir <folder>    # check the database against a copy
//
// Settings: AUDIT_SEAL_KEY_FILE (the private signing key, PEM), AUDIT_SEAL_DIR (where batches
// are written; default /var/lib/constitution/audit-seals). For --check, --key-file <file> may
// give a public key instead, so the check can be done with only the public key.
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AuditSealService,
  keyFingerprint,
  publicKeyFrom,
} from '../modules/audit/audit-seal.service';
import { createCliContext, readArgument } from './cli-app';

const USAGE = [
  'Usage: node dist/cli/audit-seal.js --generate-key',
  '       node dist/cli/audit-seal.js --public-key',
  '       node dist/cli/audit-seal.js --seal',
  '       node dist/cli/audit-seal.js --check --dir <folder> [--key-file <public key file>]',
].join('\n');

function readKey(file: string | undefined): string {
  if (!file) throw new Error('Set AUDIT_SEAL_KEY_FILE to the signing key file.');
  return readFileSync(file, 'utf8');
}

async function main(): Promise<void> {
  const action = ['--generate-key', '--public-key', '--seal', '--check'].find((flag) =>
    process.argv.includes(flag),
  );
  if (!action) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (action === '--generate-key') {
    const { privateKey } = generateKeyPairSync('ed25519');
    process.stdout.write(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    return;
  }
  if (action === '--public-key') {
    const publicKey = publicKeyFrom(readKey(process.env.AUDIT_SEAL_KEY_FILE));
    process.stdout.write(publicKey.export({ type: 'spki', format: 'pem' }).toString());
    console.log(`Fingerprint: ${keyFingerprint(publicKey)}`);
    return;
  }

  const { app } = await createCliContext();
  try {
    const service = app.get(AuditSealService);
    if (action === '--seal') {
      const result = await service.seal({
        dir: process.env.AUDIT_SEAL_DIR || '/var/lib/constitution/audit-seals',
        privateKeyPem: readKey(process.env.AUDIT_SEAL_KEY_FILE),
        // Entries younger than this wait for the next run (default 10 minutes; tests use 0).
        settleSeconds: process.env.AUDIT_SEAL_SETTLE_SECONDS
          ? Number(process.env.AUDIT_SEAL_SETTLE_SECONDS)
          : undefined,
      });
      console.log(
        `Sealed ${result.entries} new entries in ${result.batches} batch(es). ` +
          `Last entry ${result.lastSeq}, last batch ${result.lastBatch}.`,
      );
      return;
    }
    const dir = readArgument('dir');
    if (!dir) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
    const result = await service.check({
      dir,
      keyPem: readKey(readArgument('key-file') ?? process.env.AUDIT_SEAL_KEY_FILE),
    });
    console.log(
      [
        `Checked ${result.entriesSealed} sealed entries in ${result.batches} batches ` +
          `(last entry ${result.lastSealedSeq}, sealed ${result.lastSealedAt ?? 'never'}).`,
        `Allowed differences: ${result.allowed.organisationDeleted} removed with a deleted organisation, ` +
          `${result.allowed.platformDeleted} removed during an organisation deletion, ` +
          `${result.allowed.anonymised} anonymised after a person was deleted.`,
        result.ok
          ? 'Result: OK, no unexplained differences.'
          : `Result: ${result.problemCount} PROBLEM(S):`,
        ...result.problems.map((problem) => `  - ${problem}`),
      ].join('\n'),
    );
    if (!result.ok) process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
