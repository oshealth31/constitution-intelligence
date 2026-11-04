import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DocumentParser } from './document-parser';
import type { DocumentFormat, RawExtraction } from './extraction-types';

/** Documents waiting for a free worker before uploads are refused as busy. */
export const DOCUMENT_PARSE_QUEUE_LIMIT = 10;

/** The document reader with the limits from the configuration (Task D8). */
@Injectable()
export class DocumentParserService {
  private readonly parser: DocumentParser;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.parser = new DocumentParser({
      timeoutMs: config.DOCUMENT_PARSE_TIMEOUT_SECONDS * 1000,
      memoryMb: config.DOCUMENT_PARSE_MEMORY_MB,
      concurrency: config.DOCUMENT_PARSE_CONCURRENCY,
      queueLimit: DOCUMENT_PARSE_QUEUE_LIMIT,
    });
  }

  parse(format: DocumentFormat, content: Buffer): Promise<RawExtraction> {
    return this.parser.parse(format, content);
  }
}
