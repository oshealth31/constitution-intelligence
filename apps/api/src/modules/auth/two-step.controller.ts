import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { requestMeta, type AppRequest, type AuthContext } from '../../common/request-context';
import { parseInput, passwordInputSchema } from '../../common/validation';
import { CurrentAuth } from '../access/decorators';
import { TwoStepService } from './two-step.service';
import { UsersService } from './users.service';

const codeSchema = z.object({ code: z.string().trim().min(6).max(12) });
const disableSchema = z.object({
  password: passwordInputSchema,
  code: z.string().trim().min(6).max(12),
});

/**
 * The signed-in person's own two-step sign-in. Base path: /api/v1/auth/two-step
 * These routes stay open to a Super Admin who has not set it up yet (they need them to do so).
 */
@Controller('auth/two-step')
export class TwoStepController {
  constructor(
    private readonly twoStep: TwoStepService,
    private readonly users: UsersService,
  ) {}

  private async currentUser(auth: AuthContext) {
    const user = await this.users.findById(auth.userId);
    if (!user) throw new NotFoundException('Account not found.');
    return user;
  }

  @Get()
  async status(@CurrentAuth() auth: AuthContext) {
    return this.twoStep.status(await this.currentUser(auth));
  }

  /** Step 1: a new secret, as a QR code and as text. Nothing is turned on yet. */
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  async setup(@CurrentAuth() auth: AuthContext) {
    return this.twoStep.beginSetup(await this.currentUser(auth));
  }

  /** Step 2: the first code from the app. Turns it on and returns the recovery codes (once). */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { code } = parseInput(codeSchema, body);
    return this.twoStep.confirmSetup(
      await this.currentUser(auth),
      auth.sessionId,
      code,
      requestMeta(request),
    );
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  async recoveryCodes(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { code } = parseInput(codeSchema, body);
    return this.twoStep.newRecoveryCodes(await this.currentUser(auth), code, requestMeta(request));
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ): Promise<void> {
    const { password, code } = parseInput(disableSchema, body);
    await this.twoStep.disable(await this.currentUser(auth), password, code, requestMeta(request));
  }
}
