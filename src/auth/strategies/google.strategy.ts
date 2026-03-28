import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackURL = configService.get<string>('GOOGLE_CALLBACK_URL');

    super({
      clientID: clientID || 'google-oauth-not-configured',
      clientSecret: clientSecret || 'google-oauth-not-configured',
      callbackURL:
        callbackURL || 'http://localhost:4000/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    if (!profile.emails?.[0]?.value) {
      done(new UnauthorizedException('Google authentication failed.'));
      return;
    }

    done(null, {
      providerAccountId: profile.id,
      email: profile.emails?.[0]?.value ?? '',
      displayName: profile.displayName,
    });
  }
}
