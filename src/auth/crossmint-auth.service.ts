import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync as readTextFileSync } from 'node:fs';

type CrossmintJwtClaims = {
  sub: string;
  email: string;
  name: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
};

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function readPrivateKeySource(configService: ConfigService) {
  const privateKey = configService.get<string>('CROSSMINT_JWT_PRIVATE_KEY');
  if (privateKey?.trim()) {
    return privateKey;
  }

  const privateKeyFile = configService.get<string>(
    'CROSSMINT_JWT_PRIVATE_KEY_FILE',
  );
  if (privateKeyFile?.trim()) {
    return readTextFileSync(privateKeyFile, 'utf8');
  }

  return null;
}

@Injectable()
export class CrossmintAuthService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled() {
    return (
      this.configService.get<string>('CROSSMINT_ENABLED', 'false') === 'true'
    );
  }

  private getIssuer() {
    return this.configService.get<string>(
      'CROSSMINT_JWT_ISSUER',
      'lesenpad-backend',
    );
  }

  private getAudience() {
    return this.configService.get<string>(
      'CROSSMINT_JWT_AUDIENCE',
      'crossmint',
    );
  }

  private getKeyId() {
    return this.configService.get<string>(
      'CROSSMINT_JWT_KEY_ID',
      'lesenpad-crossmint',
    );
  }

  private getPrivateKeyPem() {
    const pem = readPrivateKeySource(this.configService);
    if (!pem) {
      throw new Error('Crossmint JWT signing key is not configured.');
    }

    return pem;
  }

  private getPrivateKey() {
    return createPrivateKey(this.getPrivateKeyPem());
  }

  getPublicJwks() {
    if (!this.isEnabled()) {
      return { keys: [] };
    }

    const publicKey = createPublicKey(this.getPrivateKey());
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;

    return {
      keys: [
        {
          ...jwk,
          kid: this.getKeyId(),
          use: 'sig',
          alg: 'RS256',
        },
      ],
    };
  }

  issueJwt(user: { id: string; email: string; displayName: string }) {
    if (!this.isEnabled()) {
      throw new Error('Crossmint is not enabled.');
    }

    const now = Math.floor(Date.now() / 1000);
    const claims: CrossmintJwtClaims = {
      sub: user.id,
      email: user.email,
      name: user.displayName,
      iss: this.getIssuer(),
      aud: this.getAudience(),
      iat: now,
      exp: now + 10 * 60,
      jti: `lesenpad-${user.id}-${now}`,
    };

    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: this.getKeyId(),
    };
    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
      JSON.stringify(claims),
    )}`;
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), {
      key: this.getPrivateKeyPem(),
    });

    return {
      jwt: `${signingInput}.${base64Url(signature)}`,
      expiresAt: new Date((claims.exp ?? now) * 1000).toISOString(),
      issuer: claims.iss,
      audience: claims.aud,
      keyId: this.getKeyId(),
    };
  }
}
