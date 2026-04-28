import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  CreatedWallet,
  SignedTransfer,
  SponsoredGasResult,
  WalletBalances,
  WalletProvider,
} from './wallet-provider.interface';

@Injectable()
export class CircleWalletProviderService implements WalletProvider {
  createWallet(): CreatedWallet {
    throw new NotImplementedException(
      'Circle wallet provider is not wired yet. Set WALLET_PROVIDER=solana.',
    );
  }

  signTransfer(input: {
    direction: 'CUSTODIAL_TO_TREASURY' | 'TREASURY_TO_EXTERNAL';
    encryptedPrivateKey?: string;
    destinationWalletAddress?: string;
    amountInUsdcMinor: number;
  }): Promise<SignedTransfer> {
    void input;
    throw new NotImplementedException(
      'Circle transfer signing is not implemented yet.',
    );
  }

  sponsorGas(input: { txSignature: string }): Promise<SponsoredGasResult> {
    void input;
    throw new NotImplementedException(
      'Circle gas sponsorship is not implemented yet.',
    );
  }

  getBalances(address: string): Promise<WalletBalances> {
    void address;
    throw new NotImplementedException(
      'Circle balance reading is not implemented yet.',
    );
  }

  getRecentUsdcDepositSignatures(
    ownerAddress: string,
    limit?: number,
  ): Promise<{ tokenAccountAddress: string; signatures: string[] }> {
    void ownerAddress;
    void limit;
    throw new NotImplementedException(
      'Circle deposit signature scanning is not implemented yet.',
    );
  }

  verifyUsdcDepositSignature(input: {
    signature: string;
    destinationOwnerAddress: string;
  }): Promise<{
    amountInUsdcMinor: number;
    tokenAccountAddress: string;
    confirmationSlot: number | null;
    blockTime: Date | null;
  }> {
    void input;
    throw new NotImplementedException(
      'Circle deposit signature verification is not implemented yet.',
    );
  }
}
