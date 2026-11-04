import { renderEmail, type EmailContent } from './templates';

/** The test message. The link carries a random marker so a rewritten link is easy to spot. */
export function buildTestEmail(siteUrl: string, marker: string): EmailContent & { link: string } {
  const link = `${siteUrl.replace(/\/+$/, '')}/?email-test=${marker}`;
  return {
    link,
    ...renderEmail({
      greeting: 'Hello,',
      paragraphs: [
        'This is a test email from Constitution Intelligence, sent through the email provider with the same template as invitations and password resets.',
        'Please check: it arrived in the inbox (not spam); the formatted and plain versions look right; and the button below opens exactly the address shown underneath it.',
      ],
      action: { label: 'Open the test link', url: link },
      afterAction: [`Test marker: ${marker}. You can delete this email.`],
    }),
  };
}
