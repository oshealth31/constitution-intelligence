import { DynamicModule, Global, Module } from '@nestjs/common';
import type { AppConfig } from './config';

/** Injection token for the validated configuration object. */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
