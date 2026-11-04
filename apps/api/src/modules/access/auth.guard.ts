import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../../common/request-context';
import { readSessionToken } from '../auth/session-cookie';
import { SessionService } from '../auth/session.service';
import { IS_PUBLIC } from './decorators';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';

/**
 * Runs on every request. If a session cookie is present and valid, records who the caller is.
 * Routes not marked @Public() are refused with 401 when there is no valid session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = readSessionToken(request, this.config);
    if (token) {
      const valid = await this.sessions.validate(token);
      if (valid) {
        request.auth = {
          userId: valid.user.id,
          sessionId: valid.sessionId,
          email: valid.user.email,
          displayName: valid.user.displayName,
          isPlatformSuperAdmin: valid.user.isPlatformSuperAdmin,
        };
      }
    }

    if (!isPublic && !request.auth) {
      throw new UnauthorizedException('Please sign in to continue.');
    }
    return true;
  }
}
