import { STATUS_CODES } from 'node:http';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface ErrorResponseBody {
  error: {
    statusCode: number;
    code: string;
    message: string;
    details?: string[];
    /** A machine-readable reason for some refusals, e.g. SUBSCRIPTION_INACTIVE. */
    reason?: string;
    requestId?: string;
  };
}

function extractReason(response: string | object): string | undefined {
  if (typeof response !== 'object') return undefined;
  const reason = (response as { reason?: unknown }).reason;
  return typeof reason === 'string' && /^[A-Z][A-Z_]{2,40}$/.test(reason) ? reason : undefined;
}

const GENERIC_SERVER_ERROR = 'An unexpected error occurred. Please try again later.';

function toErrorCode(status: number): string {
  return (STATUS_CODES[status] ?? 'Error').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function extractMessage(response: string | object, fallback: string): string {
  if (typeof response === 'string') {
    return response;
  }
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message;
  }
  return fallback;
}

function extractDetails(response: string | object): string[] | undefined {
  if (typeof response === 'object') {
    const message = (response as { message?: unknown }).message;
    if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
      return message;
    }
  }
  return undefined;
}

/**
 * Turns every error into one consistent JSON shape.
 * - Expected errors (4xx) keep their message so the user knows what to fix.
 * - Unexpected errors return a generic message: internal details and stack traces
 *   are written to the server log only, never sent to the browser.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = GENERIC_SERVER_ERROR;
    let details: string[] | undefined;
    let reason: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = extractMessage(body, exception.message);
      details = status < 500 ? extractDetails(body) : undefined;
      reason = status < 500 ? extractReason(body) : undefined;
      if (details) {
        message = 'The request is invalid.';
      }
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, method: request.method, url: request.url },
        'Request failed with a server error',
      );
      if (!(exception instanceof HttpException)) {
        message = GENERIC_SERVER_ERROR;
      }
    } else {
      this.logger.debug({ requestId, status, url: request.url }, 'Request rejected');
    }

    if (response.headersSent) {
      return;
    }

    const body: ErrorResponseBody = {
      error: {
        statusCode: status,
        code: toErrorCode(status),
        message,
        ...(details ? { details } : {}),
        ...(reason ? { reason } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
    response.status(status).json(body);
  }
}
