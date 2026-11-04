// Used by the deployment check workflow: signs in as a Super Admin WITH two-step sign-in on an
// API started from a RESTORED backup. Proves that the restored, encrypted authenticator secret
// still works with the kept MFA_ENCRYPTION_KEY, and that the Control Centre opens only after
// the code. Usage: node two-step-check.mjs <email> <password> <base32 key>
import { createHmac } from 'node:crypto';

const base = 'http://127.0.0.1:4000/api/v1';
const [email, password, key] = process.argv.slice(2);
const json = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' };

function fail(message) {
  console.error(`[two-step-check] FAIL ${message}`);
  process.exit(1);
}

function code(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of base32) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const number = digest.readUInt32BE(digest[digest.length - 1] & 0x0f) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, '0');
}

if (!email || !password || !/^[A-Z2-7]{16,}$/.test(key ?? ''))
  fail('usage: <email> <password> <key>');

const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ email, password }),
});
const first = await login.json();
if (login.status !== 200 || first.twoStepRequired !== true) {
  fail(`the password step did not ask for a code (status ${login.status})`);
}
if ((login.headers.get('set-cookie') ?? '').includes('ci_session')) {
  fail('a session cookie was set before the code');
}
const second = await fetch(`${base}/auth/login/two-step`, {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ challengeToken: first.challengeToken, code: code(key) }),
});
if (second.status !== 200) fail(`the code was refused (status ${second.status})`);
const cookie = (second.headers.get('set-cookie') ?? '').split(';')[0];
const overview = await fetch(`${base}/platform/overview`, { headers: { cookie } });
if (overview.status !== 200) fail(`the Control Centre answered ${overview.status}`);
console.log(
  '[two-step-check] ok restored two-step secret works; Control Centre opens after the code',
);
