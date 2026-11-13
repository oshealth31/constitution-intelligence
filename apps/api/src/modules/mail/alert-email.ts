import { z } from 'zod';
import { renderEmail, type EmailContent } from './templates';

/**
 * Operator alerts from the server watchdog (Task S5): plain facts about the platform, never
 * personal data. Sent by `node dist/cli/send-alert.js`.
 */

/** Parses "a@x.org, b@y.org" (commas, spaces or new lines). Throws if any entry is invalid. */
export function parseAlertRecipients(value: string): string[] {
  const entries = value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const unique = [...new Set(entries.map((entry) => entry.toLowerCase()))];
  if (unique.length === 0) throw new Error('No alert recipients are set.');
  if (unique.length > 5) throw new Error('At most 5 alert recipients.');
  for (const entry of unique) {
    if (!z.email().safeParse(entry).success) throw new Error('An alert recipient is not a valid email address.');
  }
  return unique;
}

/** One alert email. `lines` are the watchdog's findings, one per line. */
export function buildAlertEmail(siteAddress: string, lines: string[]): EmailContent {
  const clean = lines
    .map((line) => line.replace(/[\r\n]+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 40);
  return renderEmail({
    greeting: 'Hello,',
    paragraphs: [
      `The monitoring on the Constitution Intelligence server (${siteAddress}) reports:`,
      ...clean,
      'What to do first is in docs/operations/logging-and-monitoring.md (alert table) and incident-response.md.',
    ],
    action: { label: 'Open the Control Centre', url: `https://${siteAddress}/admin` },
    afterAction: [
      'You receive this because you are a named responder for the platform. A problem that continues is reported again after 6 hours, and you are told when it is fixed.',
    ],
  });
}
