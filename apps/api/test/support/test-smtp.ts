// A real SMTP server for tests (nodemailer's smtp-server), listening on 127.0.0.1 with STARTTLS
// and a username/password, using a throwaway certificate made with openssl for this run only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';

export const TEST_SMTP_USER = 'ci-test-sender';
export const TEST_SMTP_PASSWORD = 'throwaway-smtp-password-for-tests';

export interface ReceivedMail {
  to: string[];
  from: string;
  /** Whether the connection was encrypted when the message was sent. */
  secure: boolean;
  user: string | undefined;
  raw: string;
}

export interface TestSmtpServer {
  port: number;
  caFile: string;
  received: ReceivedMail[];
  close(): Promise<void>;
}

/** Makes a self-signed certificate for 127.0.0.1 and localhost (needs the openssl command). */
export function makeTestCertificate(): { keyFile: string; certFile: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-smtp-'));
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout', keyFile, '-out', certFile,
    ],
    { stdio: 'ignore' },
  );
  return { keyFile, certFile };
}

/** Starts the server. `offerStartTls: false` imitates a server that cannot encrypt. */
export async function startTestSmtpServer(
  options: { offerStartTls?: boolean } = {},
): Promise<TestSmtpServer> {
  const { keyFile, certFile } = makeTestCertificate();
  const received: ReceivedMail[] = [];
  const server = new SMTPServer({
    key: readFileSync(keyFile),
    cert: readFileSync(certFile),
    secure: false,
    // A server that cannot encrypt: it refuses the STARTTLS command altogether.
    disabledCommands: options.offerStartTls === false ? ['STARTTLS'] : [],
    allowInsecureAuth: options.offerStartTls === false,
    authMethods: ['PLAIN', 'LOGIN'],
    logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username === TEST_SMTP_USER && auth.password === TEST_SMTP_PASSWORD) {
        callback(null, { user: auth.username });
      } else {
        callback(new Error('Invalid username or password'));
      }
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        received.push({
          to: session.envelope.rcptTo.map((recipient) => recipient.address),
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          secure: session.secure,
          user: session.user as string | undefined,
          raw: Buffer.concat(chunks).toString('utf8'),
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.server.address() as AddressInfo).port;
  return {
    port,
    caFile: certFile,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Settings that point the API at the test server. */
export function smtpSettings(server: TestSmtpServer): Record<string, string> {
  return {
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(server.port),
    SMTP_SECURITY: 'starttls',
    SMTP_USER: TEST_SMTP_USER,
    SMTP_PASSWORD: TEST_SMTP_PASSWORD,
    SMTP_CA_FILE: server.caFile,
    MAIL_FROM: 'Constitution Intelligence <no-reply@example.test>',
    MAIL_REPLY_TO: 'support@example.test',
  };
}

/** The readable text of a raw message: undoes quoted-printable soft line breaks and escapes. */
export function decodeMessage(raw: string): string {
  return raw
    .replace(/=\r?\n/g, '') // quoted-printable soft line breaks
    .replace(/\r?\n[ \t]+/g, ' ') // unfold long header lines
    .replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
