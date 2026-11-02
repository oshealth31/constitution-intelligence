// Creates fictional accounts and organisations for the browser tests by running the real
// development seed script, then records the one-time random passwords it prints.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ACCOUNTS_FILE = path.join(__dirname, '.auth', 'accounts.json');

export default function globalSetup(): void {
  const output = execFileSync('node', [path.join(__dirname, '..', '..', 'api', 'dist', 'cli', 'seed-dev.js')], {
    env: { ...process.env, APP_ENV: 'local', NODE_ENV: 'development', LOG_LEVEL: 'warn' },
    encoding: 'utf8',
  });
  const accounts: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const match = line.match(/(\S+@sample\.test)\s+(\S+)\s*$/);
    if (match?.[1] && match[2]) {
      accounts[match[1]] = match[2];
    }
  }
  if (!accounts['superadmin@sample.test'] || !accounts['admin@sample.test']) {
    throw new Error(`Seed output did not contain the expected accounts:\n${output}`);
  }
  mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}
