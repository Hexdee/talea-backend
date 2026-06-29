import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { EmailsModule } from '../emails/emails.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CrossmintAuthService } from './crossmint-auth.service';
import { OptionalSessionAuthGuard } from './guards/optional-session-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    PassportModule.register({ session: false }),
    PrismaModule,
    EmailsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    CrossmintAuthService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
    RolesGuard,
    GoogleStrategy,
  ],
  exports: [
    AuthService,
    CrossmintAuthService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
