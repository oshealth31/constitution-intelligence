import { Module } from '@nestjs/common';
import { ConstitutionsModule } from '../constitutions/constitutions.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [ConstitutionsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
