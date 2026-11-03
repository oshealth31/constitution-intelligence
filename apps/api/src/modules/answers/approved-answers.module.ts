import { Module } from '@nestjs/common';
import { ApprovedAnswersController, ManageAnswersController } from './approved-answers.controller';
import { ApprovedAnswersService } from './approved-answers.service';
import { ManageSimpleWordsController, SimpleWordsController } from './simple-words.controller';
import { SimpleWordsService } from './simple-words.service';

/**
 * Organisation-approved explanations: answers to common questions and simple-words versions of
 * clauses. Both are written or imported as drafts and approved before members see them.
 */
@Module({
  controllers: [
    ApprovedAnswersController,
    ManageAnswersController,
    SimpleWordsController,
    ManageSimpleWordsController,
  ],
  providers: [ApprovedAnswersService, SimpleWordsService],
  exports: [ApprovedAnswersService, SimpleWordsService],
})
export class ApprovedAnswersModule {}
