import { Injectable } from '@nestjs/common';
import { PriceQuoteService } from './price-quote.service';
import { SolanaService } from './solana.service';
import type {
  SignedTransfer,
  SponsoredGasResult,
  WalletBalances,
  WalletProvider,
} from './wallet-provider.interface';

@Injectable()
export class SolanaWalletProviderService implements WalletProvider {
  constructor(
    private readonly solanaService: SolanaService,
    private readonly priceQuoteService: PriceQuoteService,
  ) {}

  createWallet() {
    return this.solanaService.createCustodialWallet();
  }

  async signTransfer(input: {
    direction: 'CUSTODIAL_TO_TREASURY' | 'TREASURY_TO_EXTERNAL';
    encryptedPrivateKey?: string;
    destinationWalletAddress?: string;
    amountInUsdcMinor: number;
  }): Promise<SignedTransfer> {
    if (input.direction === 'CUSTODIAL_TO_TREASURY') {
      if (!input.encryptedPrivateKey) {
        throw new Error(
          'encryptedPrivateKey is required for custodial-to-treasury transfers.',
        );
      }

      return this.solanaService.transferUsdcFromCustodialToTreasury({
        encryptedPrivateKey: input.encryptedPrivateKey,
        amountInUsdcMinor: input.amountInUsdcMinor,
      });
    }

    if (!input.destinationWalletAddress) {
      throw new Error(
        'destinationWalletAddress is required for treasury-to-external transfers.',
      );
    }

    return this.solanaService.transferUsdcFromTreasuryToWallet({
      destinationWalletAddress: input.destinationWalletAddress,
      amountInUsdcMinor: input.amountInUsdcMinor,
    });
  }

  async sponsorGas(input: {
    txSignature: string;
  }): Promise<SponsoredGasResult> {
    const feeInLamports = await this.solanaService.getTransactionFeeInLamports(
      input.txSignature,
    );
    const quote =
      await this.priceQuoteService.lamportsToUsdcMinorWithLockedQuote(
        feeInLamports,
      );

    return {
      txSignature: input.txSignature,
      feeInLamports,
      feeInUsdcMinor: quote.feeInUsdcMinor,
      solUsdPrice: quote.solUsdPrice,
    };
  }

  async getBalances(address: string): Promise<WalletBalances> {
    const [usdcTokenAccountAddress, usdcBalanceInUsdcMinor] = await Promise.all(
      [
        this.solanaService.getAssociatedUsdcAddress(address),
        this.solanaService.getUsdcBalance(address),
      ],
    );

    return {
      usdcTokenAccountAddress,
      usdcBalanceInUsdcMinor,
    };
  }

  getRecentUsdcDepositSignatures(ownerAddress: string, limit?: number) {
    return this.solanaService.getRecentUsdcDepositSignatures(
      ownerAddress,
      limit,
    );
  }

  verifyUsdcDepositSignature(input: {
    signature: string;
    destinationOwnerAddress: string;
  }) {
    return this.solanaService.verifyUsdcDepositSignature(input);
  }
}
