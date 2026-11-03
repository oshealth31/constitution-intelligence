/** Shared shapes for document text extraction. */

export type DocumentFormat = 'pdf' | 'docx';

/** One line (PDF) or paragraph (DOCX) of text, in reading order. */
export interface ExtractedLine {
  text: string;
  /** 1-based page number (PDF only). */
  page?: number;
  /** 0 = title, 1 = main heading, 2 = sub-heading (from Word styles or large PDF text). */
  headingLevel?: number;
  /** Number Word added automatically (e.g. "3." or "(b)"), not part of `text`. */
  autoNumber?: string;
}

export type IssueSeverity = 'error' | 'warning';

/** Something the organisation should check, in plain language. */
export interface ExtractionIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** The section this is about, if any. */
  refKey?: string;
  page?: number;
}

export interface RawExtraction {
  format: DocumentFormat;
  lines: ExtractedLine[];
  pageCount: number | null;
  issues: ExtractionIssue[];
}

export class DocumentRejectedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
