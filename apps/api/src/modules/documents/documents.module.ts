import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/** Constitution documents: upload, extraction, review, versions and approval. */
@Module({
  imports: [FilesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
