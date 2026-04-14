import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Indexer, ZgFile } from '@0glabs/0g-ts-sdk';
import { Wallet } from 'ethers';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type ZeroGUploadResult = {
  txHash: string;
  rootHash: string;
  retrievalUrl: string;
};

@Injectable()
export class ZeroGStorageService {
  private readonly indexer: Indexer;

  constructor(private readonly configService: ConfigService) {
    this.indexer = new Indexer(
      this.configService.getOrThrow<string>('ZEROG_INDEXER_RPC'),
    );
  }

  private getSigner() {
    return new Wallet(
      this.configService.getOrThrow<string>('ZEROG_PRIVATE_KEY'),
    );
  }

  private getBlockchainRpc() {
    return this.configService.getOrThrow<string>('ZEROG_RPC_URL');
  }

  private buildRetrievalUrl(rootHash: string) {
    const base = this.configService
      .getOrThrow<string>('ZEROG_INDEXER_RPC')
      .replace(/\/$/, '');

    return `${base}/file?rootHash=${rootHash}`;
  }

  async uploadEncryptedPackage(
    payload: string,
    name = 'lesenpad-encrypted-package.json',
  ): Promise<ZeroGUploadResult> {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'lesenpad-zg-upload-'),
    );
    const filePath = join(workingDirectory, name);

    try {
      await writeFile(filePath, payload, 'utf8');
      const zgFile = await ZgFile.fromFilePath(filePath);
      const [result, error] = await this.indexer.upload(
        zgFile,
        this.getBlockchainRpc(),
        this.getSigner(),
      );
      await zgFile.close();

      if (error || !result) {
        throw new InternalServerErrorException(
          `0G upload failed: ${error?.message ?? 'unknown error'}`,
        );
      }

      return {
        txHash: result.txHash,
        rootHash: result.rootHash,
        retrievalUrl: this.buildRetrievalUrl(result.rootHash),
      };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  async downloadEncryptedPackage(rootHash: string) {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'lesenpad-zg-download-'),
    );
    const filePath = join(workingDirectory, `${rootHash}.json`);

    try {
      await mkdir(workingDirectory, { recursive: true });
      const error = await this.indexer.download(rootHash, filePath, false);

      if (error) {
        throw new InternalServerErrorException(
          `0G download failed: ${error.message}`,
        );
      }

      return await readFile(filePath, 'utf8');
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }
}
