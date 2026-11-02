import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends email. A real provider is connected in a later stage; until then:
 * - "log": writes the message to the server log (local development and tests only;
 *   the configuration forbids it in staging and production because messages contain one-time links);
 * - "disabled": drops the message.
 */
@Injectable()
export class MailService {
  /** Most recent messages, kept in memory for local development and automated tests. */
  readonly outbox: OutgoingMail[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectPinoLogger(MailService.name) private readonly logger: PinoLogger,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    if (this.config.MAIL_TRANSPORT === 'disabled') {
      this.logger.warn({ subject: mail.subject }, 'Email delivery is not configured; message dropped');
      return;
    }
    this.outbox.push(mail);
    if (this.outbox.length > 50) {
      this.outbox.shift();
    }
    this.logger.info(
      { to: mail.to, subject: mail.subject, body: mail.text },
      'Email (development log transport)',
    );
  }
}
