import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';

type VaultSecretResponse = {
  data?: {
    data?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

@Injectable()
export class TreasurySecretService {
  private secretPromise: Promise<string> | null = null;

  constructor(private readonly configService: ConfigService) {}

  private readFromFile() {
    const filePath = this.configService
      .get<string>('SOLANA_TREASURY_SECRET_KEY_FILE')
      ?.trim();

    if (!filePath) {
      throw new ServiceUnavailableException(
        'SOLANA_TREASURY_SECRET_KEY_FILE is required for file-based treasury secrets.',
      );
    }

    return readFileSync(filePath, 'utf8').trim();
  }

  private getVaultToken() {
    const token = this.configService
      .get<string>('HASHICORP_VAULT_TOKEN')
      ?.trim();
    if (token) {
      return token;
    }

    const tokenFile = this.configService
      .get<string>('HASHICORP_VAULT_TOKEN_FILE')
      ?.trim();
    if (tokenFile) {
      return readFileSync(tokenFile, 'utf8').trim();
    }

    throw new ServiceUnavailableException(
      'Set HASHICORP_VAULT_TOKEN or HASHICORP_VAULT_TOKEN_FILE.',
    );
  }

  private async readFromVault() {
    const baseUrl = this.configService
      .get<string>('HASHICORP_VAULT_ADDR')
      ?.trim();
    const secretPath = this.configService
      .get<string>('HASHICORP_VAULT_SECRET_PATH')
      ?.trim();
    const secretField = this.configService.get<string>(
      'HASHICORP_VAULT_SECRET_FIELD',
      'secret',
    );
    const namespace = this.configService
      .get<string>('HASHICORP_VAULT_NAMESPACE')
      ?.trim();

    if (!baseUrl || !secretPath) {
      throw new ServiceUnavailableException(
        'HASHICORP_VAULT_ADDR and HASHICORP_VAULT_SECRET_PATH are required for vault-based treasury secrets.',
      );
    }

    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    const normalizedPath = secretPath.replace(/^\//, '');
    const response = await fetch(`${normalizedBaseUrl}/v1/${normalizedPath}`, {
      method: 'GET',
      headers: {
        'X-Vault-Token': this.getVaultToken(),
        ...(namespace ? { 'X-Vault-Namespace': namespace } : {}),
      },
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Failed to read treasury secret from HashiCorp Vault: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as VaultSecretResponse;
    const secret =
      payload.data?.data?.[secretField] ?? payload.data?.[secretField];

    if (typeof secret !== 'string' || !secret.trim()) {
      throw new ServiceUnavailableException(
        `Vault secret path ${secretPath} is missing the ${secretField} field.`,
      );
    }

    return secret.trim();
  }

  async getTreasurySecretMaterial() {
    if (this.secretPromise) {
      return this.secretPromise;
    }

    const source = this.configService.get<string>(
      'SOLANA_TREASURY_SECRET_SOURCE',
      'file',
    );

    this.secretPromise = (async () => {
      switch (source) {
        case 'env': {
          const secret = this.configService
            .get<string>('SOLANA_TREASURY_SECRET_KEY')
            ?.trim();
          if (!secret) {
            throw new ServiceUnavailableException(
              'SOLANA_TREASURY_SECRET_KEY is required when using env secrets.',
            );
          }
          return secret;
        }
        case 'vault':
          return this.readFromVault();
        case 'file':
        default:
          return this.readFromFile();
      }
    })();

    return this.secretPromise;
  }
}
