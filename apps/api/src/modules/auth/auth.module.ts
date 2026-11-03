import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { UsersService } from './users.service';

/** Identity: accounts, passwords, sessions, sign-in protection. */
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, RateLimitService, SessionService, UsersService],
  exports: [AuthService, PasswordService, RateLimitService, SessionService, UsersService],
})
export class AuthModule {}
