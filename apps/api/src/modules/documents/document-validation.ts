import { DocumentRejectedError, type DocumentFormat } from './extraction-types';

/**
 * Checks an uploaded constitution document BEFORE anything is stored or opened:
 * name, size, and the file's actual contents (not the name or the type the browser claims).
 * Only PDF and Word (.docx) are accepted.
 */

export const DOCUMENT_TYPES: Record<DocumentFormat, { extension: string; contentType: string }> = {
  pdf: { extension: '.pdf', contentType: 'application/pdf' },
  docx: {
    extension: '.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
};

export interface ValidatedDocument {
  format: DocumentFormat;
  contentType: string;
  fileName: string;
}

/** Keeps only a safe, readable file name (no folders, no control characters). */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F"<>|*?:]/g, '_') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-200);
  return cleaned || 'document';
}

// Active content we never accept in a constitution PDF: scripts and "launch" actions.
const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch)\b/;

export function validateDocument(
  rawFileName: string,
  content: Buffer,
  maxBytes: number,
): ValidatedDocument {
  const fileName = cleanFileName(rawFileName);
  const lower = fileName.toLowerCase();
  if (content.length === 0) {
    throw new DocumentRejectedError('empty_file', 'The file is empty.');
  }
  if (content.length > maxBytes) {
    throw new DocumentRejectedError(
      'too_large',
      `The file is too large. The limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    );
  }
  if (lower.endsWith('.doc') || lower.endsWith('.docm') || lower.endsWith('.dot')) {
    throw new DocumentRejectedError(
      'unsupported_type',
      'Older Word files (.doc) and Word files with macros (.docm) are not accepted. Please save the document as .docx or PDF.',
    );
  }
  const format: DocumentFormat | null = lower.endsWith('.pdf')
    ? 'pdf'
    : lower.endsWith('.docx')
      ? 'docx'
      : null;
  if (!format) {
    throw new DocumentRejectedError(
      'unsupported_type',
      'Only PDF (.pdf) and Word (.docx) documents can be uploaded.',
    );
  }

  if (format === 'pdf') {
    const head = content.subarray(0, 1024).toString('latin1');
    if (!head.includes('%PDF-')) {
      throw new DocumentRejectedError(
        'type_mismatch',
        'The file is named .pdf but is not a PDF document.',
      );
    }
    if (PDF_ACTIVE_CONTENT.test(content.toString('latin1'))) {
      throw new DocumentRejectedError(
        'active_content',
        'The PDF contains scripts or actions, which are not allowed. Please save or print it as a plain PDF and try again.',
      );
    }
  } else if (!(
    content[0] === 0x50 &&
    content[1] === 0x4b &&
    content[2] === 0x03 &&
    content[3] === 0x04
  )) {
    throw new DocumentRejectedError(
      'type_mismatch',
      'The file is named .docx but is not a Word document.',
    );
  }
  return { format, contentType: DOCUMENT_TYPES[format].contentType, fileName };
}
