import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { UsersService } from './users.service';
import { TwoStepController } from './two-step.controller';
import { TwoStepService } from './two-step.service';

/** Identity: accounts, passwords, sessions, sign-in protection. */
@Module({
  controllers: [AuthController, TwoStepController],
  providers: [
    AuthService,
    PasswordService,
    RateLimitService,
    SessionService,
    TwoStepService,
    UsersService,
  ],
  exports: [
    AuthService,
    PasswordService,
    RateLimitService,
    SessionService,
    TwoStepService,
    UsersService,
  ],
})
export class AuthModule {}
