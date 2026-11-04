import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentParserService } from './document-parser.service';

/** Constitution documents: upload, extraction, review, versions and approval. */
@Module({
  imports: [FilesModule, AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentParserService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
