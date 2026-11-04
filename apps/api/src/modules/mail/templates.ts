/**
 * Email content: every message has a plain-text version and a simple HTML version with the same
 * words. No images, no tracking pixels, no external stylesheets or fonts. Everything that comes
 * from people (names, organisation names) is escaped, so it can never become markup.
 */
export interface EmailContent {
  text: string;
  html: string;
}

export interface EmailParts {
  greeting?: string;
  paragraphs: string[];
  action: { label: string; url: string };
  /** Shown after the button, for example how long the link is valid. */
  afterAction: string[];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Removes line breaks, so a name or organisation can never add lines to an email or subject. */
export function oneLine(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
}

const FOOTER =
  'Constitution Intelligence. You received this email because of an action on your account or an invitation. Nobody from Constitution Intelligence will ask for your password.';

export function renderEmail(parts: EmailParts): EmailContent {
  const lines = [
    ...(parts.greeting ? [parts.greeting, ''] : []),
    ...parts.paragraphs.flatMap((paragraph) => [paragraph, '']),
    `${parts.action.label}:`,
    parts.action.url,
    '',
    ...parts.afterAction.flatMap((paragraph) => [paragraph, '']),
    '--',
    FOOTER,
  ];
  const text = lines.join('\n');

  const paragraph = (value: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1c2430">${escapeHtml(value)}</p>`;
  const url = escapeHtml(parts.action.url);
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Constitution Intelligence</title></head>
<body style="margin:0;padding:0;background:#fbf8f1;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf8f1;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b1f3a;padding:18px 24px;color:#fbf8f1;font-size:18px;font-weight:bold">Constitution Intelligence</td></tr>
<tr><td style="padding:24px">
${parts.greeting ? paragraph(parts.greeting) : ''}
${parts.paragraphs.map(paragraph).join('\n')}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#0e6f6f;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 20px;border-radius:8px">${escapeHtml(parts.action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5b6575">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${url}</span></p>
${parts.afterAction.map(paragraph).join('\n')}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #f5efe2;font-size:12px;line-height:1.5;color:#5b6575">${escapeHtml(FOOTER)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { text, html };
}
