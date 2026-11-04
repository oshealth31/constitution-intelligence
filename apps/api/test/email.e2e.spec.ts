// Task D1: email through SMTP. A real SMTP server runs inside the test (STARTTLS, password,
// throwaway certificate); the API sends invitations and password resets to it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/config';
import { MailService } from '../src/modules/mail/mail.service';
import { renderEmail } from '../src/modules/mail/templates';
import {
  client,
  createOrganisation,
  createUser,
  signedInMember,
  startTestApp,
  uniqueEmail,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';
import {
  decodeMessage,
  smtpSettings,
  startTestSmtpServer,
  TEST_SMTP_PASSWORD,
  TEST_SMTP_USER,
  type TestSmtpServer,
} from './support/test-smtp';

const NEW_MEMBER_PASSWORD = 'a fictional new member passphrase';

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function mailServiceFor(settings: Record<string, string>) {
  const logger = fakeLogger();
  const config = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost/db', ...settings });
  return { service: new MailService(config, logger as never), logger };
}

describe('MailService over SMTP', () => {
  let smtp: TestSmtpServer;

  beforeAll(async () => {
    smtp = await startTestSmtpServer();
  });
  afterAll(async () => {
    await smtp?.close();
  });

  it('sends text and HTML over an encrypted, signed-in connection', async () => {
    const { service, logger } = mailServiceFor(smtpSettings(smtp));
    const content = renderEmail({
      paragraphs: ['A test paragraph.'],
      action: { label: 'Open', url: 'https://portal.example.test/x?token=abc' },
      afterAction: ['After.'],
    });
    const sent = await service.send({ to: 'person@example.test', subject: 'Hello', ...content });
    expect(sent).toBe(true);
    const mail = smtp.received.at(-1)!;
    expect(mail.to).toEqual(['person@example.test']);
    expect(mail.from).toBe('no-reply@example.test');
    expect(mail.secure).toBe(true);
    expect(mail.user).toBe(TEST_SMTP_USER);
    const body = decodeMessage(mail.raw);
    expect(body).toContain('Content-Type: text/plain');
    expect(body).toContain('Content-Type: text/html');
    expect(body).toContain('https://portal.example.test/x?token=abc');
    expect(body).toMatch(/Reply-To: support@example\.test/i);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('token=abc');
    await service.onModuleDestroy();
  });

  it('refuses to send when the server cannot encrypt, and logs no secrets', async () => {
    const plain = await startTestSmtpServer({ offerStartTls: false });
    try {
      const { service, logger } = mailServiceFor(smtpSettings(plain));
      const sent = await service.send({
        to: 'person@example.test',
        subject: 'Hello',
        text: 'secret link https://x.test/?token=zzz',
      });
      expect(sent).toBe(false);
      expect(plain.received).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).not.toContain(TEST_SMTP_PASSWORD);
      expect(logged).not.toContain('token=zzz');
      expect(logged).not.toContain('person@example.test');
      await service.onModuleDestroy();
    } finally {
      await plain.close();
    }
  });

  it('fails cleanly with a wrong password or an unreachable server', async () => {
    const wrong = mailServiceFor({ ...smtpSettings(smtp), SMTP_PASSWORD: 'wrong password' });
    expect(await wrong.service.send({ to: 'a@example.test', subject: 'x', text: 'y' })).toBe(false);
    expect(JSON.stringify(wrong.logger.error.mock.calls)).not.toContain('wrong password');
    await wrong.service.onModuleDestroy();

    const closed = mailServiceFor({ ...smtpSettings(smtp), SMTP_PORT: '1' });
    expect(await closed.service.send({ to: 'a@example.test', subject: 'x', text: 'y' })).toBe(
      false,
    );
    await closed.service.onModuleDestroy();
  });

  it('keeps names from adding lines to the subject', async () => {
    const { service } = mailServiceFor(smtpSettings(smtp));
    await service.send({
      to: 'b@example.test',
      subject: 'Hi\r\nBcc: evil@example.test',
      text: 'z',
    });
    const mail = smtp.received.at(-1)!;
    expect(mail.to).toEqual(['b@example.test']);
    expect(mail.raw).not.toMatch(/^Bcc:/m);
    await service.onModuleDestroy();
  });
});

describe('email templates', () => {
  it('escapes names and organisation names in the HTML version', () => {
    const { html, text } = renderEmail({
      greeting: 'Hello <script>alert(1)</script>,',
      paragraphs: ['Join "Choir" & friends'],
      action: { label: 'Accept', url: 'https://portal.example.test/a?token=t&x="y"' },
      afterAction: [],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://portal.example.test/a?token=t&amp;x=&quot;y&quot;"');
    expect(html).not.toMatch(/<img|<link|<script/);
    expect(text).toContain('https://portal.example.test/a?token=t&x="y"');
  });
});

describe.runIf(Boolean(testDatabaseUrl))('invitations and password resets by email', () => {
  let smtp: TestSmtpServer;
  let context: TestContext;

  beforeAll(async () => {
    smtp = await startTestSmtpServer();
    context = await startTestApp(smtpSettings(smtp));
  });
  afterAll(async () => {
    await context?.close();
    await smtp?.close();
  });

  function tokenIn(to: string): string {
    const mail = [...smtp.received].reverse().find((item) => item.to.includes(to));
    const match = mail && decodeMessage(mail.raw).match(/token=([A-Za-z0-9_-]+)/);
    if (!match?.[1]) throw new Error(`No link sent to ${to}`);
    return match[1];
  }

  it('emails an invitation that the person can accept', async () => {
    const organisation = await createOrganisation(context.db);
    const { agent } = await signedInMember(context, organisation.id, 'owner');
    const email = uniqueEmail('invited');
    const created = await agent
      .post(`/api/v1/organisations/${organisation.id}/invitations`)
      .send({ email, role: 'member' })
      .expect(201);
    expect(created.body.emailDelivered).toBe(true);

    const mail = [...smtp.received].reverse().find((item) => item.to.includes(email))!;
    const body = decodeMessage(mail.raw);
    expect(body).toMatch(/Subject: You are invited to Fictional Organisation \d+ on Constitution/);
    expect(body).toContain('Accept the invitation');

    await client(context)
      .post('/api/v1/invitations/accept')
      .send({
        token: tokenIn(email),
        displayName: 'Fictional Member',
        password: NEW_MEMBER_PASSWORD,
      })
      .expect(200);
  });

  it('emails a password reset link that works', async () => {
    const user = await createUser(context.db, { email: uniqueEmail('forgot') });
    await client(context)
      .post('/api/v1/auth/password/forgot')
      .send({ email: user.email })
      .expect(202);
    await client(context)
      .post('/api/v1/auth/password/reset')
      .send({ token: tokenIn(user.email), newPassword: 'a completely new passphrase' })
      .expect(204);
  });

  it('still creates the invitation when the email cannot be sent, and says so', async () => {
    const broken = await startTestApp({ ...smtpSettings(smtp), SMTP_PORT: '1' });
    try {
      const organisation = await createOrganisation(broken.db);
      const { agent } = await signedInMember(broken, organisation.id, 'owner');
      const email = uniqueEmail('not-delivered');
      const created = await agent
        .post(`/api/v1/organisations/${organisation.id}/invitations`)
        .send({ email, role: 'member' })
        .expect(201);
      expect(created.body.emailDelivered).toBe(false);
      const list = await agent
        .get(`/api/v1/organisations/${organisation.id}/invitations`)
        .expect(200);
      expect(list.body.some((item: { email: string }) => item.email === email)).toBe(true);
      // Password resets answer the same whether or not the email went out.
      const user = await createUser(broken.db, { email: uniqueEmail('reset-not-delivered') });
      await client(broken)
        .post('/api/v1/auth/password/forgot')
        .send({ email: user.email })
        .expect(202);
    } finally {
      await broken.close();
    }
  });
});
