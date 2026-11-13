// Sends ONE operator alert email (Task S5). Used by the server watchdog
// (ops/server/watchdog.sh); the findings are read from standard input, one per line.
//
//   printf 'PROBLEM: disk 85%% full\n' | node dist/cli/send-alert.js --to a@x.org,b@y.org --subject "…"
//
// Needs only the email settings; no database. Prints no addresses (logs may be shared).
import { z } from 'zod';
import { loadLocalEnv } from '@constitution/shared';
import { loadConfig } from '../config/config';
import { buildAlertEmail, parseAlertRecipients } from '../modules/mail/alert-email';
import { MailService } from '../modules/mail/mail.service';
import { readArgument } from './cli-app';

const logger = {
  info: (_details: unknown, message: string) => console.log(message),
  warn: (_details: unknown, message: string) => console.warn(message),
  error: (details: unknown, message: string) =>
    console.error(`${message} ${JSON.stringify(details)}`),
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').slice(0, 20_000);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const subject = z.string().trim().min(3).max(150).safeParse(readArgument('subject'));
  let recipients: string[];
  try {
    recipients = parseAlertRecipients(readArgument('to') ?? '');
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  if (!subject.success) {
    console.error('Usage: … | node dist/cli/send-alert.js --to a@x.org --subject "Alert"');
    process.exitCode = 1;
    return;
  }
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://unused@localhost/unused',
    LOG_LEVEL: 'warn',
  });
  const site = new URL(config.WEB_BASE_URL).host;
  const message = buildAlertEmail(site, (await readStdin()).split('\n'));
  const mail = new MailService(config, logger as never);
  let failures = 0;
  for (const to of recipients) {
    const sent = await mail.send({
      to,
      subject: subject.data.replace(/[\r\n]+/g, ' '),
      ...message,
    });
    if (!sent) failures += 1;
  }
  await mail.onModuleDestroy();
  if (failures > 0) {
    console.error(`The alert could not be sent to ${failures} of ${recipients.length} recipients.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Alert sent to ${recipients.length} recipient(s).`);
}

void main();
