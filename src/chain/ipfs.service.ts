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

  private getGatewayBase() {
    return (
      this.configService.get<string>('IPFS_GATEWAY_BASE')?.replace(/\/$/, '') ??
      'https://gateway.pinata.cloud'
    );
  }

  private getGatewayUrl(cid: string) {
    return `${this.getGatewayBase()}/ipfs/${cid}`;
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
    const response = await fetch(this.getGatewayUrl(cid));

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Pinata download failed with ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    return (await response.json()) as T;
  }

  async downloadEncryptedPackage(cid: string) {
    const payload = await this.downloadJson(cid);
    return JSON.stringify(payload);
  }
}
