import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requestMeta, type AppRequest } from '../../common/request-context';
import { displayNameSchema, parseInput, passwordInputSchema } from '../../common/validation';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { Public } from '../access/decorators';
import { setSessionCookie } from '../auth/session-cookie';
import { SessionService } from '../auth/session.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { InvitationsService } from './invitations.service';

const acceptSchema = z.object({
  token: z.string({ error: 'is required' }).min(20).max(200),
  displayName: displayNameSchema.optional(),
  password: passwordInputSchema.optional(),
});

/** Base path: /api/v1/invitations */
@Controller('invitations')
export class InvitationAcceptanceController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionService,
    private readonly rateLimits: RateLimitService,
  ) {}

  /**
   * Public, because a newly invited person has no account yet (they choose a name and password here
   * and are signed in). Someone who already has an account must be signed in as the invited email.
   */
  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body() body: unknown,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const meta = requestMeta(request);
    // Public route: stop scripts from trying invitation links (or creating accounts) at speed.
    await this.rateLimits.assertWithin(
      `invite-accept:ip:${meta.ipAddress ?? 'unknown'}`,
      this.config.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60,
      this.config.LOGIN_MAX_ATTEMPTS_PER_IP,
    );
    const input = parseInput(acceptSchema, body);
    const result = await this.invitations.accept(input, request.auth, meta);
    if (result.newUserId) {
      const session = await this.sessions.create(result.newUserId, meta);
      setSessionCookie(response, session.token, session.expiresAt, this.config);
    }
    return { organisationId: result.organisationId, role: result.role };
  }
}
