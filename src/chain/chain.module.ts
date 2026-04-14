import { Global, Module } from '@nestjs/common';
import { IpfsService } from './ipfs.service';
import { MediaStorageService } from './media-storage.service';
import { SolanaService } from './solana.service';
import { VaultService } from './vault.service';

@Global()
@Module({
  providers: [VaultService, SolanaService, IpfsService, MediaStorageService],
  exports: [VaultService, SolanaService, IpfsService, MediaStorageService],
})
export class ChainModule {}
