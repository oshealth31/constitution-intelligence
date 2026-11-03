import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { ConstitutionsModule } from '../constitutions/constitutions.module';
import { AI_PROVIDER, createAiProvider } from './ai-provider';
import { AiRetrievalService } from './ai-retrieval.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/** AI question answering from the organisation's approved constitution. */
@Module({
  imports: [ConstitutionsModule, AuthModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiRetrievalService,
    { provide: AI_PROVIDER, useFactory: (config: AppConfig) => createAiProvider(config), inject: [APP_CONFIG] },
  ],
})
export class AiModule {}
