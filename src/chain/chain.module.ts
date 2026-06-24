import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircleWalletProviderService } from './circle-wallet-provider.service';
import { IpfsService } from './ipfs.service';
import { MediaStorageService } from './media-storage.service';
import { PriceQuoteService } from './price-quote.service';
import { SolanaService } from './solana.service';
import { SolanaWalletProviderService } from './solana-wallet-provider.service';
import { VaultService } from './vault.service';
import { TreasurySecretService } from './treasury-secret.service';
import { WALLET_PROVIDER } from './wallet-provider.token';

@Global()
@Module({
  providers: [
    VaultService,
    SolanaService,
    PriceQuoteService,
    IpfsService,
    MediaStorageService,
    SolanaWalletProviderService,
    CircleWalletProviderService,
    TreasurySecretService,
    {
      provide: WALLET_PROVIDER,
      inject: [
        ConfigService,
        SolanaWalletProviderService,
        CircleWalletProviderService,
      ],
      useFactory: (
        configService: ConfigService,
        solanaProvider: SolanaWalletProviderService,
        circleProvider: CircleWalletProviderService,
      ) => {
        const provider = configService.get<string>('WALLET_PROVIDER', 'solana');
        return provider === 'circle' ? circleProvider : solanaProvider;
      },
    },
  ],
  exports: [
    VaultService,
    SolanaService,
    PriceQuoteService,
    IpfsService,
    MediaStorageService,
    TreasurySecretService,
    WALLET_PROVIDER,
  ],
})
export class ChainModule {}
