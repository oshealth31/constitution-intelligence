// Sends ONE test email through the configured email provider, with the same code and template
// the application uses for invitations and password resets.
//
//   node dist/cli/send-test-email.js --to you@example.com
//
// Needs only the email settings (MAIL_TRANSPORT=smtp, SMTP_HOST, SMTP_USER, SMTP_PASSWORD or
// SMTP_PASSWORD_FILE, MAIL_FROM); no database. Use it after setting up or changing the email
// provider, and check in the received email that the button's link points directly to the
// address below (not rewritten by the provider's link tracking).
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { loadLocalEnv } from '@constitution/shared';
import { loadConfig } from '../config/config';
import { MailService } from '../modules/mail/mail.service';
import { buildTestEmail } from '../modules/mail/test-email';
import { readArgument } from './cli-app';

const logger = {
  info: (_details: unknown, message: string) => console.log(message),
  warn: (_details: unknown, message: string) => console.warn(message),
  error: (details: unknown, message: string) =>
    console.error(`${message} ${JSON.stringify(details)}`),
};

async function main(): Promise<void> {
  loadLocalEnv();
  const to = z.email().safeParse(readArgument('to')?.trim());
  if (!to.success) {
    console.error('Usage: node dist/cli/send-test-email.js --to you@example.com');
    process.exitCode = 1;
    return;
  }
  // The database is not used by this command; the setting is only required by the shared
  // configuration check, so a placeholder is supplied when it is missing.
  const config = loadConfig({
    ...process.env,
    // On the server DATABASE_URL_FILE is set instead; both together are refused.
    ...(process.env.DATABASE_URL || process.env.DATABASE_URL_FILE
      ? {}
      : { DATABASE_URL: 'postgresql://unused@localhost/unused' }),
    LOG_LEVEL: 'warn',
  });
  if (config.MAIL_TRANSPORT !== 'smtp') {
    console.error('MAIL_TRANSPORT must be "smtp" to send a real test email.');
    process.exitCode = 1;
    return;
  }
  const marker = randomBytes(6).toString('hex');
  const message = buildTestEmail(config.WEB_BASE_URL, marker);
  const mail = new MailService(config, logger as never);
  const sent = await mail.send({
    to: to.data,
    subject: `Constitution Intelligence email test ${marker}`,
    text: message.text,
    html: message.html,
  });
  await mail.onModuleDestroy();
  if (!sent) {
    console.error('The test email could not be sent (see the error code above).');
    process.exitCode = 1;
    return;
  }
  console.log(`Test email sent to ${to.data}.`);
  console.log(`Marker: ${marker}`);
  console.log(`The button must open exactly: ${message.link}`);
}

void main();
