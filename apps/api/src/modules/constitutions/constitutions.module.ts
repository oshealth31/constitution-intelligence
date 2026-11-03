import { Module } from '@nestjs/common';
import { ConstitutionsController } from './constitutions.controller';
import { ConstitutionsService } from './constitutions.service';
import { ReaderSearchService } from './reader-search.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [ConstitutionsController, SearchController],
  providers: [ConstitutionsService, SearchService, ReaderSearchService],
  exports: [ConstitutionsService, SearchService],
})
export class ConstitutionsModule {}
