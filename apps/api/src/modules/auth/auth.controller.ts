import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requestMeta, type AppRequest, type AuthContext } from '../../common/request-context';
import { emailSchema, parseInput, passwordInputSchema } from '../../common/validation';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { CurrentAuth, Public } from '../access/decorators';
import { AuthService } from './auth.service';
import { clearSessionCookie, setSessionCookie } from './session-cookie';
import { UsersService, toPublicUser } from './users.service';

const loginSchema = z.object({ email: emailSchema, password: passwordInputSchema });
const forgotSchema = z.object({ email: emailSchema });
const tokenSchema = z.string({ error: 'is required' }).min(20).max(200);

const resetSchema = z.object({ token: tokenSchema, newPassword: passwordInputSchema });
const changeSchema = z.object({
  currentPassword: passwordInputSchema,
  newPassword: passwordInputSchema,
});

/**
 * Sign-in, sign-out and password management.
 * Base path: /api/v1/auth
 */
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { email, password } = parseInput(loginSchema, body);
    const { session, user } = await this.authService.login(email, password, requestMeta(request));
    setSessionCookie(response, session.token, session.expiresAt, this.config);
    return { user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(auth.userId, auth.sessionId, requestMeta(request));
    clearSessionCookie(response, this.config);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logoutEverywhere(auth.userId, requestMeta(request));
    clearSessionCookie(response, this.config);
  }

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    const user = await this.usersService.findById(auth.userId);
    const memberships = await this.usersService.listActiveMemberships(auth.userId);
    return { user: user ? toPublicUser(user) : null, memberships };
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() body: unknown, @Req() request: AppRequest) {
    const { email } = parseInput(forgotSchema, body);
    await this.authService.requestPasswordReset(email, requestMeta(request));
    return {
      message:
        'If an account exists for this email address, a password reset link has been sent to it.',
    };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: unknown, @Req() request: AppRequest): Promise<void> {
    const { token, newPassword } = parseInput(resetSchema, body);
    await this.authService.resetPassword(token, newPassword, requestMeta(request));
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ): Promise<void> {
    const { currentPassword, newPassword } = parseInput(changeSchema, body);
    await this.authService.changePassword(
      auth.userId,
      auth.sessionId,
      currentPassword,
      newPassword,
      requestMeta(request),
    );
  }
}
