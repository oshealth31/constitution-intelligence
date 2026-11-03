import type { IncomingMessage, ServerResponse } from 'node:http';
import { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../config/config';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id';

/**
 * Structured JSON logging (pino). Every request gets a request ID, which is
 * returned in the "x-request-id" response header and included in error responses,
 * so a user's error report can be matched to the server logs.
 */
export function createLoggingModule(config: AppConfig): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: {
      level: config.LOG_LEVEL,
      transport: config.LOG_PRETTY
        ? {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          }
        : undefined,
      base: { service: 'api', env: config.APP_ENV, version: config.APP_VERSION },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      // Log only what is needed; never headers (they can carry cookies or tokens).
      serializers: {
        req: (req: { id?: unknown; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
          '*.secret',
          '*.apiKey',
          '*["x-api-key"]',
        ],
        censor: '[REDACTED]',
      },
      // Health checks are polled constantly; keep them out of the request log.
      autoLogging: {
        ignore: (req: IncomingMessage) => (req.url ?? '').includes('/health/'),
      },
    },
  });
}
