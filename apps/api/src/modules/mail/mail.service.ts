import { readFileSync } from 'node:fs';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { oneLine } from './templates';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends email (invitations, password resets).
 * - "smtp": through the email provider's SMTP server, always encrypted: STARTTLS is required on
 *   port 587 ("starttls") or TLS from the start on port 465 ("tls"); the server's certificate is
 *   checked. Messages are not kept in memory.
 * - "log": written to the server log and kept in memory (local development and automated tests;
 *   refused in staging and production because messages contain one-time links).
 * - "disabled": dropped with a warning (refused in production).
 *
 * Sending never throws. It returns false when the message could not be sent, and logs why,
 * without the message body (which contains one-time links), the password or the recipient.
 * The action that sends the email still completes: an invitation can be sent again, and a
 * password reset can be requested again.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  /** Most recent messages ("log" transport only), for local development and automated tests. */
  readonly outbox: OutgoingMail[] = [];
  private transporter: Transporter | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectPinoLogger(MailService.name) private readonly logger: PinoLogger,
  ) {}

  async send(mail: OutgoingMail): Promise<boolean> {
    const message = { ...mail, subject: oneLine(mail.subject), to: oneLine(mail.to) };
    switch (this.config.MAIL_TRANSPORT) {
      case 'disabled':
        this.logger.warn(
          { subject: message.subject },
          'Email delivery is not configured; message dropped',
        );
        return false;
      case 'log':
        this.outbox.push(message);
        if (this.outbox.length > 50) {
          this.outbox.shift();
        }
        this.logger.info(
          { to: message.to, subject: message.subject, body: message.text },
          'Email (development log transport)',
        );
        return true;
      case 'smtp':
        return this.sendSmtp(message);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.transporter?.close();
  }

  private async sendSmtp(mail: OutgoingMail): Promise<boolean> {
    try {
      await this.smtp().sendMail({
        from: this.config.MAIL_FROM,
        replyTo: this.config.MAIL_REPLY_TO,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        // Message content never comes from files or web addresses.
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      this.logger.info({ subject: mail.subject }, 'Email sent');
      return true;
    } catch (error) {
      const details = error as { code?: unknown; responseCode?: unknown; command?: unknown };
      // Only codes: provider messages may echo addresses or other details.
      this.logger.error(
        {
          subject: mail.subject,
          code: typeof details.code === 'string' ? details.code : undefined,
          responseCode: typeof details.responseCode === 'number' ? details.responseCode : undefined,
          command: typeof details.command === 'string' ? details.command : undefined,
        },
        'Email could not be sent',
      );
      return false;
    }
  }

  private smtp(): Transporter {
    if (!this.transporter) {
      const config = this.config;
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURITY === 'tls',
        requireTLS: config.SMTP_SECURITY === 'starttls',
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
        tls: {
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
          ...(config.SMTP_CA_FILE ? { ca: readFileSync(config.SMTP_CA_FILE) } : {}),
        },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return this.transporter;
  }
}
