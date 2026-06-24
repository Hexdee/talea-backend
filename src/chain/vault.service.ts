import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

type EncryptedPayload = {
  iv: string;
  tag: string;
  value: string;
};

function toBase64(input: Buffer | Uint8Array) {
  return Buffer.from(input).toString('base64');
}

function fromBase64(value: string) {
  return Buffer.from(value, 'base64');
}

function parseEncryptedPayload(input: string): EncryptedPayload {
  return JSON.parse(input) as EncryptedPayload;
}

@Injectable()
export class VaultService {
  constructor(private readonly configService: ConfigService) {}

  private getMasterKey() {
    const configured =
      this.configService.getOrThrow<string>('CHAIN_MASTER_KEY');

    return createHash('sha256').update(configured).digest();
  }

  hashString(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  randomKey(length = 32) {
    return randomBytes(length);
  }

  encryptString(value: string, key = this.getMasterKey()) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    return JSON.stringify({
      iv: toBase64(iv),
      tag: toBase64(cipher.getAuthTag()),
      value: toBase64(encrypted),
    } satisfies EncryptedPayload);
  }

  decryptString(payload: string, key = this.getMasterKey()) {
    const parsed = parseEncryptedPayload(payload);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      fromBase64(parsed.iv),
    );
    decipher.setAuthTag(fromBase64(parsed.tag));

    return Buffer.concat([
      decipher.update(fromBase64(parsed.value)),
      decipher.final(),
    ]).toString('utf8');
  }

  encryptBuffer(value: Buffer, key: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);

    return {
      cipherSpec: 'aes-256-gcm:v1',
      payload: JSON.stringify({
        iv: toBase64(iv),
        tag: toBase64(cipher.getAuthTag()),
        value: toBase64(encrypted),
      } satisfies EncryptedPayload),
    };
  }

  decryptBuffer(payload: string, key: Buffer) {
    const parsed = parseEncryptedPayload(payload);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      fromBase64(parsed.iv),
    );
    decipher.setAuthTag(fromBase64(parsed.tag));

    return Buffer.concat([
      decipher.update(fromBase64(parsed.value)),
      decipher.final(),
    ]);
  }
}
