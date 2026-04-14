import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthAccountProvider, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type {
  AuthenticatedRequest,
  SessionUser,
} from '../common/types/authenticated-request';
import { SolanaService } from '../chain/solana.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function readCookieValue(
  cookies: AuthenticatedRequest['cookies'],
  cookieName: string,
) {
  const value: unknown = cookies ? Reflect.get(cookies, cookieName) : undefined;
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly solanaService: SolanaService,
  ) {}

  private getCookieName() {
    return this.configService.get<string>(
      'SESSION_COOKIE_NAME',
      'lesenpad_session',
    );
  }

  private getSessionTtlDays() {
    return Number(this.configService.get<string>('SESSION_TTL_DAYS', '14'));
  }

  private getFrontendAppUrl() {
    return this.configService.get<string>(
      'FRONTEND_APP_URL',
      'http://localhost:3000',
    );
  }

  private toSessionUser(user: {
    id: string;
    email: string;
    displayName: string;
    roles: Role[];
  }): SessionUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
    };
  }

  private sessionCookieOptions() {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const maxAge = this.getSessionTtlDays() * 24 * 60 * 60 * 1000;
    const sameSite: 'none' | 'lax' = isProduction ? 'none' : 'lax';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite,
      maxAge,
      path: '/',
    };
  }

  async resolveSessionUser(request: AuthenticatedRequest) {
    const token = readCookieValue(request.cookies, this.getCookieName());

    if (!token) {
      return null;
    }

    const session = await this.prisma.session.findUnique({
      where: {
        tokenHash: hashToken(token),
      },
      include: {
        user: true,
      },
    });

    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    return this.toSessionUser(session.user);
  }

  async signup(dto: SignupDto, response: Response) {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
    });

    if (existingUser) {
      throw new BadRequestException(
        'An account already exists for this email.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const custodialWallet = this.solanaService.createCustodialWallet();

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        roles: [Role.USER],
        authAccounts: {
          create: {
            provider: AuthAccountProvider.LOCAL,
            providerAccountId: dto.email,
            passwordHash,
          },
        },
        wallet: {
          create: {},
        },
        chainWallets: {
          create: {
            address: custodialWallet.address,
            label: 'Lesenpad custodial wallet',
            custodyType: 'CUSTODIAL',
            encryptedPrivateKey: custodialWallet.encryptedPrivateKey,
            isDefault: true,
            isCreatorPayoutWallet: true,
          },
        },
      },
    });

    await this.createSession(user, response);
    return this.toSessionUser(user);
  }

  async login(dto: LoginDto, response: Response) {
    const account = await this.prisma.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: AuthAccountProvider.LOCAL,
          providerAccountId: dto.email,
        },
      },
      include: {
        user: true,
      },
    });

    if (!account?.passwordHash) {
      throw new UnauthorizedException('Invalid login credentials.');
    }

    const matches = await bcrypt.compare(dto.password, account.passwordHash);

    if (!matches) {
      throw new UnauthorizedException('Invalid login credentials.');
    }

    await this.createSession(account.user, response);
    return this.toSessionUser(account.user);
  }

  async logout(request: AuthenticatedRequest, response: Response) {
    const token = readCookieValue(request.cookies, this.getCookieName());

    if (token) {
      await this.prisma.session.deleteMany({
        where: {
          tokenHash: hashToken(token),
        },
      });
    }

    response.clearCookie(this.getCookieName(), this.sessionCookieOptions());
    return { success: true };
  }

  async upsertGoogleUser(
    payload: {
      providerAccountId: string;
      email: string;
      displayName: string;
    },
    response: Response,
  ) {
    const custodialWallet = this.solanaService.createCustodialWallet();

    const user = await this.prisma.user.upsert({
      where: {
        email: payload.email,
      },
      update: {
        displayName: payload.displayName,
        authAccounts: {
          upsert: {
            where: {
              provider_providerAccountId: {
                provider: AuthAccountProvider.GOOGLE,
                providerAccountId: payload.providerAccountId,
              },
            },
            create: {
              provider: AuthAccountProvider.GOOGLE,
              providerAccountId: payload.providerAccountId,
            },
            update: {},
          },
        },
      },
      create: {
        email: payload.email,
        displayName: payload.displayName,
        roles: [Role.USER],
        authAccounts: {
          create: {
            provider: AuthAccountProvider.GOOGLE,
            providerAccountId: payload.providerAccountId,
          },
        },
        wallet: {
          create: {},
        },
        chainWallets: {
          create: {
            address: custodialWallet.address,
            label: 'Lesenpad custodial wallet',
            custodyType: 'CUSTODIAL',
            encryptedPrivateKey: custodialWallet.encryptedPrivateKey,
            isDefault: true,
            isCreatorPayoutWallet: true,
          },
        },
      },
    });

    await this.createSession(user, response);
    return this.toSessionUser(user);
  }

  googleRedirectUrl() {
    return `${this.getFrontendAppUrl()}/auth/callback`;
  }

  async createSession(
    user: {
      id: string;
      email: string;
      displayName: string;
      roles: Role[];
    },
    response: Response,
  ) {
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + this.getSessionTtlDays() * 24 * 60 * 60 * 1000,
    );

    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });

    response.cookie(
      this.getCookieName(),
      rawToken,
      this.sessionCookieOptions(),
    );
  }
}
