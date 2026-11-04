// Creates fictional accounts and organisations for the browser tests by running the real
// development seed script, then records the one-time random passwords it prints.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ACCOUNTS_FILE = path.join(__dirname, '.auth', 'accounts.json');
export const TWO_STEP_FILE = path.join(__dirname, '.auth', 'two-step.json');
const LAST_STEP_FILE = path.join(__dirname, '.auth', 'two-step-last-step.json');

export default function globalSetup(): void {
  const output = execFileSync(
    'node',
    [path.join(__dirname, '..', '..', 'api', 'dist', 'cli', 'seed-dev.js')],
    {
      env: { ...process.env, APP_ENV: 'local', NODE_ENV: 'development', LOG_LEVEL: 'warn' },
      encoding: 'utf8',
    },
  );
  const accounts: Record<string, string> = {};
  const twoStepKeys: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const key = line.match(/(\S+@sample\.test) two-step key: ([A-Z2-7]+)\s*$/);
    if (key?.[1] && key[2]) {
      twoStepKeys[key[1]] = key[2];
      continue;
    }
    const match = line.match(/(\S+@sample\.test)\s+(\S+)\s*$/);
    if (match?.[1] && match[2]) {
      accounts[match[1]] = match[2];
    }
  }
  if (!accounts['superadmin@sample.test'] || !accounts['admin@sample.test']) {
    throw new Error(`Seed output did not contain the expected accounts:\n${output}`);
  }
  if (!twoStepKeys['superadmin@sample.test']) {
    throw new Error(`Seed output did not contain the Super Admin's two-step key:\n${output}`);
  }
  mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  writeFileSync(TWO_STEP_FILE, JSON.stringify(twoStepKeys, null, 2));
  rmSync(LAST_STEP_FILE, { force: true });
}
