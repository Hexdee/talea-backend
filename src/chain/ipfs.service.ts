import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type PinataResponse = {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
};

type IpfsUploadResult = {
  cid: string;
  gatewayUrl: string | null;
  uri: string;
};

@Injectable()
export class IpfsService {
  constructor(private readonly configService: ConfigService) {}

  private normalizeGatewayBase(value: string) {
    const trimmed = value.trim().replace(/\/$/, '');
    if (!trimmed) {
      return trimmed;
    }

    try {
      return new URL(trimmed).toString().replace(/\/$/, '');
    } catch {
      // Allow configuring the gateway host without a scheme (eg "foo.mypinata.cloud").
      return `https://${trimmed}`.replace(/\/$/, '');
    }
  }

  private getGatewayBase() {
    const raw =
      this.configService.get<string>('IPFS_GATEWAY_BASE') ??
      'https://gateway.pinata.cloud';
    return this.normalizeGatewayBase(raw);
  }

  private getReadGatewayBases() {
    const raw = this.configService.get<string>('IPFS_READ_GATEWAY_BASES');
    const bases = (
      raw
        ? raw.split(',').map((value) => value.trim())
        : [
            // Prefer the configured gateway first for performance.
            this.getGatewayBase(),
            // Fallback public-good gateways (operated by IPFS Foundation/IPShipyard).
            // Ref: https://ipfs.github.io/public-gateway-checker/
            'https://ipfs.io',
            'https://dweb.link',
            'https://trustless-gateway.link',
          ]
    ).filter(Boolean);

    // Normalize and de-duplicate.
    const normalized: string[] = [];
    for (const base of bases) {
      const item = this.normalizeGatewayBase(base);
      if (item && !normalized.includes(item)) normalized.push(item);
    }

    return normalized;
  }

  private getGatewayUrl(cid: string, gatewayBase = this.getGatewayBase()) {
    return `${gatewayBase}/ipfs/${cid}`;
  }

  private async pinJson(
    name: string,
    content: unknown,
  ): Promise<IpfsUploadResult> {
    const jwt = this.configService.get<string>('PINATA_JWT')?.trim();

    if (!jwt) {
      throw new InternalServerErrorException(
        'PINATA_JWT is required for IPFS uploads.',
      );
    }

    const response = await fetch(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pinataMetadata: {
            name,
          },
          pinataContent: content,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Pinata upload failed with ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as PinataResponse;
    const gatewayUrl = this.getGatewayUrl(data.IpfsHash);

    return {
      cid: data.IpfsHash,
      gatewayUrl: gatewayUrl ?? null,
      uri: gatewayUrl ?? `ipfs://${data.IpfsHash}`,
    };
  }

  uploadEncryptedPackage(payload: string, name = 'lesenpad-chapter-package') {
    return this.pinJson(name, JSON.parse(payload) as unknown);
  }

  uploadJson(name: string, content: unknown) {
    return this.pinJson(name, content);
  }

  async downloadJson<T = unknown>(cid: string): Promise<T> {
    const gateways = this.getReadGatewayBases();
    const errors: string[] = [];

    for (const gatewayBase of gateways) {
      let response: Response;
      try {
        response = await fetch(this.getGatewayUrl(cid, gatewayBase), {
          signal: AbortSignal.timeout(15_000),
          headers: {
            accept: 'application/json',
            'user-agent': 'lesenpad-backend',
          },
        });
      } catch (error) {
        errors.push(
          `${gatewayBase}: ${
            error instanceof Error ? error.message : 'Request failed'
          }`,
        );
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        errors.push(`${gatewayBase}: ${response.status} ${body.slice(0, 120)}`);
        continue;
      }

      try {
        return (await response.json()) as T;
      } catch (error) {
        errors.push(
          `${gatewayBase}: invalid JSON response (${
            error instanceof Error ? error.message : 'parse error'
          })`,
        );
      }
    }

    throw new InternalServerErrorException(
      `IPFS download failed for CID ${cid}. Tried gateways:\n- ${errors.join(
        '\n- ',
      )}`,
    );
  }

  async downloadEncryptedPackage(cid: string) {
    const payload = await this.downloadJson(cid);
    return JSON.stringify(payload);
  }
}
