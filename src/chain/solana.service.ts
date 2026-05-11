import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';
import {
  base58,
  generateSigner,
  keypairIdentity,
  keypairPayer,
  none,
  percentAmount,
  publicKey,
  some,
  TransactionBuilder,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  collectionToggle,
  createNft,
  findMasterEditionPda,
  findMetadataPda,
  mplTokenMetadata,
  safeFetchMetadata,
  printSupply,
  printV1,
  TokenStandard,
  updateV1,
  verifyCollectionV1,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  fromWeb3JsKeypair,
  toWeb3JsPublicKey,
} from '@metaplex-foundation/umi-web3js-adapters';
import { VaultService } from './vault.service';

type CreatedWallet = {
  address: string;
  encryptedPrivateKey: string;
};

type ChainTransfer = {
  signature: string;
  confirmationSlot: number | null;
  blockTime: Date | null;
  sourceTokenAccountAddress: string;
  destinationTokenAccountAddress: string;
  feeInLamports: number;
};

type MintedAsset = {
  mintAddress: string;
  tokenAccountAddress: string;
  editionAddress: string;
  editionMetadataAddress: string;
  signature: string;
  confirmationSlot: number | null;
  blockTime: Date | null;
  feeInLamports: number;
};

type EditionAsset = {
  masterMintAddress: string;
  metadataAddress: string;
  masterEditionAddress: string;
  metadataUri?: string | null;
  collectionMintAddress: string | null;
  signature: string;
  confirmationSlot: number | null;
  blockTime: Date | null;
  feeInLamports: number;
};

type CollectionAsset = {
  mintAddress: string;
  metadataAddress: string;
  masterEditionAddress: string;
  metadataUri?: string | null;
  signature: string;
  confirmationSlot: number | null;
  blockTime: Date | null;
  feeInLamports: number;
};

type LatestDeposit = {
  signature: string | null;
  balanceInUsdcMinor: number;
  tokenAccountAddress: string;
};

type UmiSendAndConfirmResult = Awaited<
  ReturnType<TransactionBuilder['sendAndConfirm']>
>;

function parseSecretKey(value: string, label: string) {
  const trimmed = value.trim();

  try {
    if (trimmed.startsWith('[')) {
      return Uint8Array.from(JSON.parse(trimmed) as number[]);
    }

    return Uint8Array.from(Buffer.from(trimmed, 'base64'));
  } catch (error) {
    throw new InternalServerErrorException(
      `${label} must be a JSON byte array or base64-encoded secret key.`,
      { cause: error },
    );
  }
}

function signatureToBase58(signature: Uint8Array) {
  return base58.deserialize(signature)[0];
}

@Injectable()
export class SolanaService {
  private static readonly MPL_TOKEN_METADATA_PROGRAM_ID =
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

  private readonly connection: Connection;
  private readonly logger = new Logger(SolanaService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly vaultService: VaultService,
  ) {
    this.connection = new Connection(
      this.configService.getOrThrow<string>('SOLANA_RPC_URL'),
      this.getConfirmationCommitment(),
    );
  }

  getNetwork() {
    return this.configService.get<string>('SOLANA_NETWORK', 'devnet');
  }

  getConfirmationCommitment(): 'processed' | 'confirmed' | 'finalized' {
    return this.configService.get<'processed' | 'confirmed' | 'finalized'>(
      'SOLANA_CONFIRMATION_COMMITMENT',
      'confirmed',
    );
  }

  private getFinalityCommitment(): 'confirmed' | 'finalized' {
    return this.getConfirmationCommitment() === 'finalized'
      ? 'finalized'
      : 'confirmed';
  }

  getUsdcMintAddress() {
    return this.configService.getOrThrow<string>('SOLANA_USDC_MINT_ADDRESS');
  }

  private getUsdcMint() {
    const mint = this.getUsdcMintAddress();
    try {
      return new PublicKey(mint);
    } catch (error) {
      throw new ServiceUnavailableException(
        'SOLANA_USDC_MINT_ADDRESS is invalid. Configure a valid devnet USDC mint address.',
        { cause: error },
      );
    }
  }

  private getTreasuryKeypair() {
    const secret = this.configService.getOrThrow<string>(
      'SOLANA_TREASURY_SECRET_KEY',
    );

    return Keypair.fromSecretKey(
      parseSecretKey(secret, 'SOLANA_TREASURY_SECRET_KEY'),
    );
  }

  private decryptCustodialKeypair(encryptedPrivateKey: string) {
    return Keypair.fromSecretKey(
      parseSecretKey(
        this.vaultService.decryptString(encryptedPrivateKey),
        'custodial wallet private key',
      ),
    );
  }

  private async getSlotAndBlockTime(signature: string) {
    const tx = await this.connection.getTransaction(signature, {
      commitment: this.getFinalityCommitment(),
      maxSupportedTransactionVersion: 0,
    });

    return {
      slot: tx?.slot ?? null,
      blockTime: tx?.blockTime ? new Date(tx.blockTime * 1000) : null,
      feeInLamports: tx?.meta?.fee ?? 0,
    };
  }

  async getTransactionFeeInLamports(signature: string) {
    const meta = await this.getSlotAndBlockTime(signature);
    return meta.feeInLamports;
  }

  private createUmiWithTreasury() {
    const treasury = this.getTreasuryKeypair();
    const umi = createUmi(this.connection.rpcEndpoint).use(mplTokenMetadata());

    umi.use(keypairIdentity(fromWeb3JsKeypair(treasury)));

    return { treasury, umi };
  }

  private createUmiWithTreasuryPayer(identity?: Keypair) {
    const treasury = this.getTreasuryKeypair();
    const umi = createUmi(this.connection.rpcEndpoint).use(mplTokenMetadata());
    const effectiveIdentity = identity ?? treasury;

    // Keep identity and fee-payer separate: identity signs authority actions,
    // treasury pays for fees/rent.
    umi.use(keypairIdentity(fromWeb3JsKeypair(effectiveIdentity), false));
    umi.use(keypairPayer(fromWeb3JsKeypair(treasury)));

    return { treasury, umi };
  }

  private getTreasuryMinLamports() {
    return Number(
      this.configService.get<string>(
        'SOLANA_TREASURY_MIN_LAMPORTS',
        '20000000',
      ),
    );
  }

  private formatLamports(lamports: number) {
    const sol = lamports / LAMPORTS_PER_SOL;
    return `${lamports} lamports (${sol.toFixed(4)} SOL)`;
  }

  private async assertSignerCanPayFees(signer: Keypair, label: string) {
    const account = await this.connection.getAccountInfo(
      signer.publicKey,
      this.getFinalityCommitment(),
    );
    if (!account) {
      throw new ServiceUnavailableException(
        `${label} wallet is not funded on ${this.getNetwork()} (account does not exist). Fund ${signer.publicKey.toBase58()} with SOL to pay transaction fees.`,
      );
    }

    const balance = await this.connection.getBalance(
      signer.publicKey,
      this.getFinalityCommitment(),
    );
    const minimum = this.getTreasuryMinLamports();
    if (balance < minimum) {
      throw new ServiceUnavailableException(
        `${label} wallet has insufficient SOL for fees on ${this.getNetwork()}. Balance: ${this.formatLamports(
          balance,
        )}. Minimum: ${this.formatLamports(minimum)}. Fund ${signer.publicKey.toBase58()} with SOL.`,
      );
    }
  }

  private async waitForAccountOwnedBy(input: {
    address: string;
    owner: string;
    label: string;
    timeoutMs?: number;
    intervalMs?: number;
  }) {
    const timeoutMs = input.timeoutMs ?? 30_000;
    const intervalMs = input.intervalMs ?? 1_000;
    const startedAt = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const info = await this.connection.getAccountInfo(
        new PublicKey(input.address),
        this.getFinalityCommitment(),
      );

      if (info && info.owner.toBase58() === input.owner) {
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new ServiceUnavailableException(
          `${input.label} account ${input.address} is not available on ${this.getNetwork()} yet (expected owner: ${input.owner}). Try again in a few seconds.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  private async sendAndConfirmUmi(
    builder: TransactionBuilder,
    umi: ReturnType<typeof createUmi>,
    context: string,
  ): Promise<UmiSendAndConfirmResult> {
    try {
      return await builder.sendAndConfirm(umi, {
        confirm: {
          commitment: this.getConfirmationCommitment(),
        },
      });
    } catch (error) {
      if (error instanceof SendTransactionError) {
        let logs: string[] | undefined;
        try {
          logs = await error.getLogs(this.connection);
        } catch {
          logs = undefined;
        }

        const message = String(error.message ?? 'SendTransactionError');
        const joinedLogs = logs?.join('\n') ?? '';
        if (
          message.includes(
            'Attempt to debit an account but found no record of a prior credit',
          )
        ) {
          throw new ServiceUnavailableException(
            `${context} failed because the fee payer account is unfunded or does not exist on-chain. Ensure SOLANA_TREASURY_SECRET_KEY points to a funded wallet on ${this.getNetwork()} (pubkey: ${this.getTreasuryKeypair().publicKey.toBase58()}).`,
          );
        }
        if (
          message.includes('IncorrectOwner') ||
          joinedLogs.includes('Incorrect account owner')
        ) {
          this.logger.warn(
            `${context} failed with IncorrectOwner. Logs:\n${joinedLogs || '(no logs)'}`,
          );
          throw new BadRequestException(
            `${context} failed: Incorrect account owner. This usually means one of the accounts passed into token-metadata verification is not a valid token-metadata account on the configured cluster. Common causes: (1) book.collectionMintAddress is wrong for this SOLANA_RPC_URL (devnet vs mainnet mismatch), (2) a stored chapter edition metadata/master edition address in the DB is stale/wrong for this cluster, or (3) RPC inconsistency right after minting/creating accounts. Re-run diagnostics for the specific book/chapter on the same RPC.`,
          );
        }

        this.logger.error(
          `${context} failed: ${message}${logs?.length ? `\nLogs:\n${joinedLogs}` : ''}`,
        );
        throw new InternalServerErrorException(
          `${context} failed to send Solana transaction. ${message}`,
          { cause: error },
        );
      }

      throw error;
    }
  }

  private getCollectionAccounts(
    umi: ReturnType<typeof createUmi>,
    collectionMintAddress: string,
  ) {
    const collectionMint = publicKey(collectionMintAddress);
    const collectionMetadata = findMetadataPda(umi, {
      mint: collectionMint,
    });
    const collectionMasterEdition = findMasterEditionPda(umi, {
      mint: collectionMint,
    });

    return {
      collectionMint,
      collectionMetadata,
      collectionMasterEdition,
    };
  }

  private async ensureTokenAccount(owner: PublicKey, payer: Keypair) {
    await this.assertSignerCanPayFees(payer, 'Fee payer');
    const tokenAccount = await getAssociatedTokenAddress(
      this.getUsdcMint(),
      owner,
    );
    const accountInfo = await this.connection.getAccountInfo(tokenAccount);

    if (!accountInfo) {
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          tokenAccount,
          owner,
          this.getUsdcMint(),
        ),
      );

      try {
        await sendAndConfirmTransaction(this.connection, transaction, [payer], {
          commitment: this.getConfirmationCommitment(),
        });
      } catch (error) {
        if (error instanceof SendTransactionError) {
          let logs: string[] | undefined;
          try {
            logs = await error.getLogs(this.connection);
          } catch {
            logs = undefined;
          }
          this.logger.error(
            `ensureTokenAccount failed: ${error.message}${logs?.length ? `\nLogs:\n${logs.join('\n')}` : ''}`,
          );
        }
        throw error;
      }
    }

    return tokenAccount;
  }

  createCustodialWallet(): CreatedWallet {
    const keypair = Keypair.generate();

    return {
      address: keypair.publicKey.toBase58(),
      encryptedPrivateKey: this.vaultService.encryptString(
        Buffer.from(keypair.secretKey).toString('base64'),
      ),
    };
  }

  isValidAddress(address: string) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  async getAssociatedUsdcAddress(ownerAddress: string) {
    return (
      await getAssociatedTokenAddress(
        this.getUsdcMint(),
        new PublicKey(ownerAddress),
      )
    ).toBase58();
  }

  async getUsdcBalance(ownerAddress: string) {
    const tokenAccount = await getAssociatedTokenAddress(
      this.getUsdcMint(),
      new PublicKey(ownerAddress),
    );

    try {
      const account = await getAccount(
        this.connection,
        tokenAccount,
        this.getConfirmationCommitment(),
      );

      return Number(account.amount);
    } catch {
      return 0;
    }
  }

  async getLatestDepositSnapshot(ownerAddress: string): Promise<LatestDeposit> {
    const tokenAccount = await getAssociatedTokenAddress(
      this.getUsdcMint(),
      new PublicKey(ownerAddress),
    );
    const balanceInUsdcMinor = await this.getUsdcBalance(ownerAddress);
    const signatures = await this.connection.getSignaturesForAddress(
      tokenAccount,
      { limit: 1 },
      this.getFinalityCommitment(),
    );

    return {
      signature: signatures[0]?.signature ?? null,
      balanceInUsdcMinor,
      tokenAccountAddress: tokenAccount.toBase58(),
    };
  }

  async getRecentUsdcDepositSignatures(ownerAddress: string, limit = 25) {
    const tokenAccount = await getAssociatedTokenAddress(
      this.getUsdcMint(),
      new PublicKey(ownerAddress),
    );
    const signatures = await this.connection.getSignaturesForAddress(
      tokenAccount,
      { limit },
      this.getFinalityCommitment(),
    );

    return {
      tokenAccountAddress: tokenAccount.toBase58(),
      signatures: signatures.map((item) => item.signature),
    };
  }

  async verifyUsdcDepositSignature(input: {
    signature: string;
    destinationOwnerAddress: string;
  }) {
    let transaction: Awaited<
      ReturnType<Connection['getParsedTransaction']>
    > | null = null;
    try {
      transaction = await this.connection.getParsedTransaction(
        input.signature,
        {
          commitment: this.getFinalityCommitment(),
          maxSupportedTransactionVersion: 0,
        },
      );
    } catch (error) {
      throw new BadRequestException(
        'Invalid deposit signature or unsupported transaction format.',
        { cause: error },
      );
    }

    if (!transaction?.meta) {
      throw new BadRequestException('Deposit transaction was not found.');
    }

    const destinationOwner = input.destinationOwnerAddress;
    const mint = this.getUsdcMintAddress();
    const pre = transaction.meta.preTokenBalances ?? [];
    const post = transaction.meta.postTokenBalances ?? [];
    const before = pre
      .filter((item) => item.owner === destinationOwner && item.mint === mint)
      .reduce((sum, item) => sum + BigInt(item.uiTokenAmount.amount), 0n);
    const after = post
      .filter((item) => item.owner === destinationOwner && item.mint === mint)
      .reduce((sum, item) => sum + BigInt(item.uiTokenAmount.amount), 0n);
    const delta = after - before;

    if (delta <= 0n) {
      throw new BadRequestException(
        'That transaction did not increase this wallet’s devnet USDC balance.',
      );
    }

    return {
      signature: input.signature,
      amountInUsdcMinor: Number(delta),
      tokenAccountAddress: (
        await getAssociatedTokenAddress(
          this.getUsdcMint(),
          new PublicKey(input.destinationOwnerAddress),
        )
      ).toBase58(),
      confirmationSlot: transaction.slot,
      blockTime: transaction.blockTime
        ? new Date(transaction.blockTime * 1000)
        : null,
    };
  }

  async transferUsdcFromCustodialToTreasury(input: {
    encryptedPrivateKey: string;
    amountInUsdcMinor: number;
  }): Promise<ChainTransfer> {
    const buyer = this.decryptCustodialKeypair(input.encryptedPrivateKey);
    const treasury = this.getTreasuryKeypair();
    await this.assertSignerCanPayFees(treasury, 'Treasury');
    const source = await this.ensureTokenAccount(buyer.publicKey, treasury);
    const destination = await this.ensureTokenAccount(
      treasury.publicKey,
      treasury,
    );
    const sourceAccount = await getAccount(
      this.connection,
      source,
      this.getConfirmationCommitment(),
    );

    if (sourceAccount.amount < BigInt(input.amountInUsdcMinor)) {
      throw new BadRequestException(
        'Insufficient devnet USDC balance in the Lesenpad custodial wallet.',
      );
    }

    const transaction = new Transaction().add(
      createTransferInstruction(
        source,
        destination,
        buyer.publicKey,
        BigInt(input.amountInUsdcMinor),
      ),
    );
    transaction.feePayer = treasury.publicKey;

    let signature: string;
    try {
      signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [treasury, buyer],
        { commitment: this.getConfirmationCommitment() },
      );
    } catch (error) {
      if (error instanceof SendTransactionError) {
        let logs: string[] | undefined;
        try {
          logs = await error.getLogs(this.connection);
        } catch {
          logs = undefined;
        }
        this.logger.error(
          `transferUsdcFromCustodialToTreasury failed: ${error.message}${logs?.length ? `\nLogs:\n${logs.join('\n')}` : ''}`,
        );
      }
      throw error;
    }
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
      sourceTokenAccountAddress: source.toBase58(),
      destinationTokenAccountAddress: destination.toBase58(),
      feeInLamports: meta.feeInLamports,
    };
  }

  async transferUsdcFromTreasuryToWallet(input: {
    destinationWalletAddress: string;
    amountInUsdcMinor: number;
  }): Promise<ChainTransfer> {
    const treasury = this.getTreasuryKeypair();
    await this.assertSignerCanPayFees(treasury, 'Treasury');
    const destinationOwner = new PublicKey(input.destinationWalletAddress);
    const source = await this.ensureTokenAccount(treasury.publicKey, treasury);
    const destination = await this.ensureTokenAccount(
      destinationOwner,
      treasury,
    );
    const sourceAccount = await getAccount(
      this.connection,
      source,
      this.getConfirmationCommitment(),
    );

    if (sourceAccount.amount < BigInt(input.amountInUsdcMinor)) {
      throw new BadRequestException(
        'Lesenpad treasury does not have enough devnet USDC for this withdrawal.',
      );
    }

    const transaction = new Transaction().add(
      createTransferInstruction(
        source,
        destination,
        treasury.publicKey,
        BigInt(input.amountInUsdcMinor),
      ),
    );
    let signature: string;
    try {
      signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [treasury],
        { commitment: this.getConfirmationCommitment() },
      );
    } catch (error) {
      if (error instanceof SendTransactionError) {
        let logs: string[] | undefined;
        try {
          logs = await error.getLogs(this.connection);
        } catch {
          logs = undefined;
        }
        this.logger.error(
          `transferUsdcFromTreasuryToWallet failed: ${error.message}${logs?.length ? `\nLogs:\n${logs.join('\n')}` : ''}`,
        );
      }
      throw error;
    }
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
      sourceTokenAccountAddress: source.toBase58(),
      destinationTokenAccountAddress: destination.toBase58(),
      feeInLamports: meta.feeInLamports,
    };
  }

  async createChapterEditionAsset(input: {
    name: string;
    uri: string;
    maxCopies: number;
    collectionMintAddress?: string | null;
    authorityEncryptedPrivateKey?: string | null;
  }): Promise<EditionAsset> {
    const identity = input.authorityEncryptedPrivateKey
      ? this.decryptCustodialKeypair(input.authorityEncryptedPrivateKey)
      : undefined;
    const { treasury, umi } = this.createUmiWithTreasuryPayer(identity);
    await this.assertSignerCanPayFees(treasury, 'Treasury');
    const masterMint = generateSigner(umi);
    const metadata = findMetadataPda(umi, {
      mint: masterMint.publicKey,
    });
    const masterEdition = findMasterEditionPda(umi, {
      mint: masterMint.publicKey,
    });
    const collectionOption = input.collectionMintAddress
      ? {
          verified: false,
          key: publicKey(input.collectionMintAddress),
        }
      : null;
    const baseBuilder = createNft(umi, {
      mint: masterMint,
      name: input.name.slice(0, 32),
      symbol: 'LSPAD',
      uri: input.uri,
      sellerFeeBasisPoints: percentAmount(0),
      isMutable: false,
      creators: none(),
      // Set the collection reference during creation, then verify it in a
      // dedicated instruction.
      collection: collectionOption,
      printSupply: some(printSupply('Limited', [input.maxCopies])),
    });

    let builder = baseBuilder;
    let collectionVerified = false;
    if (input.collectionMintAddress) {
      const collectionAccounts = this.getCollectionAccounts(
        umi,
        input.collectionMintAddress,
      );
      // If the collection was minted moments ago, it may be confirmed but not
      // yet visible for account reads on all RPC nodes. Token Metadata will
      // fail with `IncorrectOwner` during verification if the collection
      // metadata/master edition accounts are not readable yet.
      await this.waitForAccountOwnedBy({
        address: toWeb3JsPublicKey(
          collectionAccounts.collectionMetadata[0],
        ).toBase58(),
        owner: SolanaService.MPL_TOKEN_METADATA_PROGRAM_ID,
        label: 'Collection metadata',
      });
      await this.waitForAccountOwnedBy({
        address: toWeb3JsPublicKey(
          collectionAccounts.collectionMasterEdition[0],
        ).toBase58(),
        owner: SolanaService.MPL_TOKEN_METADATA_PROGRAM_ID,
        label: 'Collection master edition',
      });

      builder = baseBuilder.add(
        verifyCollectionV1(umi, {
          metadata,
          collectionMint: publicKey(input.collectionMintAddress),
          authority: umi.identity,
        }),
      );
      collectionVerified = true;
    }

    const result = await this.sendAndConfirmUmi(
      builder,
      umi,
      'createChapterEditionAsset',
    );
    const signature = signatureToBase58(result.signature);
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      masterMintAddress: toWeb3JsPublicKey(masterMint.publicKey).toBase58(),
      metadataAddress: toWeb3JsPublicKey(metadata[0]).toBase58(),
      masterEditionAddress: toWeb3JsPublicKey(masterEdition[0]).toBase58(),
      collectionMintAddress:
        collectionVerified && input.collectionMintAddress
          ? input.collectionMintAddress
          : null,
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
      feeInLamports: meta.feeInLamports,
    };
  }

  async createBookCollectionAsset(input: {
    name: string;
    uri: string;
    authorityEncryptedPrivateKey?: string | null;
  }): Promise<CollectionAsset> {
    const identity = input.authorityEncryptedPrivateKey
      ? this.decryptCustodialKeypair(input.authorityEncryptedPrivateKey)
      : undefined;
    const { treasury, umi } = this.createUmiWithTreasuryPayer(identity);
    await this.assertSignerCanPayFees(treasury, 'Treasury');
    const collectionMint = generateSigner(umi);
    const metadata = findMetadataPda(umi, {
      mint: collectionMint.publicKey,
    });
    const masterEdition = findMasterEditionPda(umi, {
      mint: collectionMint.publicKey,
    });

    const builder = createNft(umi, {
      mint: collectionMint,
      name: input.name.slice(0, 32),
      symbol: 'LSPAD',
      uri: input.uri,
      sellerFeeBasisPoints: percentAmount(0),
      isMutable: true,
      creators: none(),
      collection: none(),
      isCollection: true,
    });
    const result = await this.sendAndConfirmUmi(
      builder,
      umi,
      'createBookCollectionAsset',
    );
    // Ensure the collection accounts are readable before we persist and
    // immediately reuse the collection mint in chapter publishing flows.
    await this.waitForAccountOwnedBy({
      address: toWeb3JsPublicKey(metadata[0]).toBase58(),
      owner: SolanaService.MPL_TOKEN_METADATA_PROGRAM_ID,
      label: 'Collection metadata',
    });
    await this.waitForAccountOwnedBy({
      address: toWeb3JsPublicKey(masterEdition[0]).toBase58(),
      owner: SolanaService.MPL_TOKEN_METADATA_PROGRAM_ID,
      label: 'Collection master edition',
    });
    const signature = signatureToBase58(result.signature);
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      mintAddress: toWeb3JsPublicKey(collectionMint.publicKey).toBase58(),
      metadataAddress: toWeb3JsPublicKey(metadata[0]).toBase58(),
      masterEditionAddress: toWeb3JsPublicKey(masterEdition[0]).toBase58(),
      metadataUri: input.uri,
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
      feeInLamports: meta.feeInLamports,
    };
  }

  async attachNftToCollection(input: {
    nftMetadataAddress: string;
    collectionMintAddress: string;
    authorityEncryptedPrivateKey?: string | null;
  }) {
    const identity = input.authorityEncryptedPrivateKey
      ? this.decryptCustodialKeypair(input.authorityEncryptedPrivateKey)
      : undefined;
    const { treasury, umi } = this.createUmiWithTreasuryPayer(identity);
    await this.assertSignerCanPayFees(treasury, 'Treasury');
    const collection = this.getCollectionAccounts(
      umi,
      input.collectionMintAddress,
    );
    await this.waitForAccountOwnedBy({
      address: toWeb3JsPublicKey(collection.collectionMetadata[0]).toBase58(),
      owner: SolanaService.MPL_TOKEN_METADATA_PROGRAM_ID,
      label: 'Collection metadata',
    });
    await this.waitForAccountOwnedBy({
      address: toWeb3JsPublicKey(
        collection.collectionMasterEdition[0],
      ).toBase58(),
      owner: SolanaService.MPL_TOKEN_METADATA_PROGRAM_ID,
      label: 'Collection master edition',
    });

    const nftMetadata = await safeFetchMetadata(
      umi,
      publicKey(input.nftMetadataAddress),
    );
    if (!nftMetadata) {
      throw new BadRequestException(
        `attachNftToCollection failed: metadata account ${input.nftMetadataAddress} does not exist on ${this.getNetwork()}.`,
      );
    }

    const builder = updateV1(umi, {
      mint: nftMetadata.mint,
      metadata: publicKey(input.nftMetadataAddress),
      payer: umi.payer,
      authority: umi.identity,
      collection: collectionToggle('Set', [
        { verified: false, key: collection.collectionMint },
      ]),
    }).add(
      verifyCollectionV1(umi, {
        metadata: publicKey(input.nftMetadataAddress),
        collectionMint: collection.collectionMint,
        authority: umi.identity,
      }),
    );
    const result = await this.sendAndConfirmUmi(
      builder,
      umi,
      'attachNftToCollection',
    );
    const signature = signatureToBase58(result.signature);
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
      feeInLamports: meta.feeInLamports,
    };
  }

  async mintChapterAsset(input: {
    masterMintAddress: string;
    destinationWalletAddress: string;
    editionNumber: number;
    collectionMintAddress?: string | null;
    masterTokenAccountOwnerEncryptedPrivateKey?: string | null;
  }): Promise<MintedAsset> {
    const destination = new PublicKey(input.destinationWalletAddress);
    const identity = input.masterTokenAccountOwnerEncryptedPrivateKey
      ? this.decryptCustodialKeypair(
          input.masterTokenAccountOwnerEncryptedPrivateKey,
        )
      : undefined;
    const { treasury, umi } = this.createUmiWithTreasuryPayer(identity);
    await this.assertSignerCanPayFees(treasury, 'Treasury');
    const editionMint = generateSigner(umi);
    const metadata = findMetadataPda(umi, {
      mint: editionMint.publicKey,
    });
    const edition = findMasterEditionPda(umi, {
      mint: editionMint.publicKey,
    });
    let builder = printV1(umi, {
      editionMint,
      editionTokenAccountOwner: publicKey(input.destinationWalletAddress),
      masterEditionMint: publicKey(input.masterMintAddress),
      tokenStandard: TokenStandard.NonFungible,
      editionNumber: input.editionNumber,
    });

    const result = await this.sendAndConfirmUmi(
      builder,
      umi,
      'mintChapterAsset',
    );
    const signature = signatureToBase58(result.signature);
    const meta = await this.getSlotAndBlockTime(signature);
    const mintAddress = toWeb3JsPublicKey(editionMint.publicKey);
    const tokenAccount = await getAssociatedTokenAddress(
      mintAddress,
      destination,
    );
    return {
      mintAddress: mintAddress.toBase58(),
      tokenAccountAddress: tokenAccount.toBase58(),
      editionAddress: toWeb3JsPublicKey(edition[0]).toBase58(),
      editionMetadataAddress: toWeb3JsPublicKey(metadata[0]).toBase58(),
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
      feeInLamports: meta.feeInLamports,
    };
  }

  async getUsdcMintDecimals() {
    const mint = await getMint(
      this.connection,
      this.getUsdcMint(),
      this.getConfirmationCommitment(),
    );

    return mint.decimals;
  }
}
