import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

type UploadedMediaAsset = {
  url: string;
  path: string;
  mimeType: string;
};

@Injectable()
export class MediaStorageService {
  private readonly client: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: this.configService.getOrThrow<string>('R2_ENDPOINT'),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'R2_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  private getBucket() {
    return this.configService.getOrThrow<string>('R2_BUCKET');
  }

  private getPublicBaseUrl() {
    return this.configService
      .getOrThrow<string>('R2_PUBLIC_BASE_URL')
      .replace(/\/$/, '');
  }

  async uploadPublicAsset(input: {
    folder: 'covers' | 'editor-media';
    filename: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<UploadedMediaAsset> {
    const key = `${input.folder}/${input.filename}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
        Body: input.buffer,
        ContentType: input.mimeType,
        CacheControl:
          input.folder === 'covers'
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=604800',
      }),
    );

    const url = `${this.getPublicBaseUrl()}/${key}`;

    if (!url.startsWith('http')) {
      throw new InternalServerErrorException(
        'R2_PUBLIC_BASE_URL must be an absolute public URL.',
      );
    }

    return {
      url,
      path: key,
      mimeType: input.mimeType,
    };
  }
}
