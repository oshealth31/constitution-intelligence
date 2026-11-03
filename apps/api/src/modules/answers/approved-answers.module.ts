import { Module } from '@nestjs/common';
import {
  ApprovedAnswersController,
  ManageAnswersController,
} from './approved-answers.controller';
import { ApprovedAnswersService } from './approved-answers.service';

/** Approved answers: organisation-written answers to common questions, approved before use. */
@Module({
  controllers: [ApprovedAnswersController, ManageAnswersController],
  providers: [ApprovedAnswersService],
  exports: [ApprovedAnswersService],
})
export class ApprovedAnswersModule {}
