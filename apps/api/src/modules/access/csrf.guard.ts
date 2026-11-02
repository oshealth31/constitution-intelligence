import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { AppRequest } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Header the web app must send with every state-changing request. */
export const CSRF_HEADER = 'x-requested-with';

/**
 * Cross-site request forgery protection for cookie-based sessions.
 * For POST/PUT/PATCH/DELETE:
 * 1. A custom header must be present. Browsers only let another website send custom headers
 *    after a CORS check, which our origin allow-list refuses.
 * 2. If the browser states an Origin, it must be one of the allowed web origins.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }
    if (!request.headers[CSRF_HEADER]) {
      throw new ForbiddenException('Missing required request header.');
    }
    const origin = request.headers.origin;
    if (typeof origin === 'string' && !this.config.CORS_ORIGINS.includes(origin)) {
      throw new ForbiddenException('Request origin is not allowed.');
    }
    return true;
  }
}
