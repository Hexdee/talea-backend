export type CreatedWallet = {
  address: string;
  encryptedPrivateKey: string;
};

export type WalletBalances = {
  usdcBalanceInUsdcMinor: number;
  usdcTokenAccountAddress: string;
};

export type SignedTransfer = {
  signature: string;
  sourceTokenAccountAddress: string;
  destinationTokenAccountAddress: string;
  confirmationSlot: number | null;
  blockTime: Date | null;
  feeInLamports: number;
};

export type SponsoredGasResult = {
  txSignature: string;
  feeInLamports: number;
  feeInUsdcMinor: number;
  solUsdPrice: number;
};

export interface WalletProvider {
  createWallet(): CreatedWallet;
  signTransfer(input: {
    direction: 'CUSTODIAL_TO_TREASURY' | 'TREASURY_TO_EXTERNAL';
    encryptedPrivateKey?: string;
    destinationWalletAddress?: string;
    amountInUsdcMinor: number;
  }): Promise<SignedTransfer>;
  sponsorGas(input: { txSignature: string }): Promise<SponsoredGasResult>;
  getBalances(address: string): Promise<WalletBalances>;
  getRecentUsdcDepositSignatures(
    ownerAddress: string,
    limit?: number,
  ): Promise<{
    tokenAccountAddress: string;
    signatures: string[];
  }>;
  verifyUsdcDepositSignature(input: {
    signature: string;
    destinationOwnerAddress: string;
  }): Promise<{
    amountInUsdcMinor: number;
    tokenAccountAddress: string;
    confirmationSlot: number | null;
    blockTime: Date | null;
  }>;
}
