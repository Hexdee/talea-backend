import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
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
  none,
  percentAmount,
  publicKey,
  some,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  collectionDetails,
  createNft,
  findMasterEditionPda,
  findMetadataPda,
  mplTokenMetadata,
  printSupply,
  printV1,
  setAndVerifySizedCollectionItem,
  TokenStandard,
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
};

type MintedAsset = {
  mintAddress: string;
  tokenAccountAddress: string;
  editionAddress: string;
  editionMetadataAddress: string;
  signature: string;
  confirmationSlot: number | null;
  blockTime: Date | null;
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
};

type CollectionAsset = {
  mintAddress: string;
  metadataAddress: string;
  masterEditionAddress: string;
  metadataUri?: string | null;
  signature: string;
  confirmationSlot: number | null;
  blockTime: Date | null;
};

type LatestDeposit = {
  signature: string | null;
  balanceInUsdcMinor: number;
  tokenAccountAddress: string;
};

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
  private readonly connection: Connection;

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
    return new PublicKey(this.getUsdcMintAddress());
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
    };
  }

  private createUmiWithTreasury() {
    const treasury = this.getTreasuryKeypair();
    const umi = createUmi(this.connection.rpcEndpoint).use(mplTokenMetadata());

    umi.use(keypairIdentity(fromWeb3JsKeypair(treasury)));

    return { treasury, umi };
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

      await sendAndConfirmTransaction(this.connection, transaction, [payer], {
        commitment: this.getConfirmationCommitment(),
      });
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

  async verifyUsdcDepositSignature(input: {
    signature: string;
    destinationOwnerAddress: string;
  }) {
    const transaction = await this.connection.getParsedTransaction(
      input.signature,
      {
        commitment: this.getFinalityCommitment(),
        maxSupportedTransactionVersion: 0,
      },
    );

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

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [treasury, buyer],
      { commitment: this.getConfirmationCommitment() },
    );
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
      sourceTokenAccountAddress: source.toBase58(),
      destinationTokenAccountAddress: destination.toBase58(),
    };
  }

  async transferUsdcFromTreasuryToWallet(input: {
    destinationWalletAddress: string;
    amountInUsdcMinor: number;
  }): Promise<ChainTransfer> {
    const treasury = this.getTreasuryKeypair();
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
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [treasury],
      { commitment: this.getConfirmationCommitment() },
    );
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
      sourceTokenAccountAddress: source.toBase58(),
      destinationTokenAccountAddress: destination.toBase58(),
    };
  }

  async createChapterEditionAsset(input: {
    name: string;
    uri: string;
    maxCopies: number;
    collectionMintAddress?: string | null;
  }): Promise<EditionAsset> {
    const { umi } = this.createUmiWithTreasury();
    const masterMint = generateSigner(umi);
    const metadata = findMetadataPda(umi, {
      mint: masterMint.publicKey,
    });
    const masterEdition = findMasterEditionPda(umi, {
      mint: masterMint.publicKey,
    });
    let builder = createNft(umi, {
      mint: masterMint,
      name: input.name.slice(0, 32),
      symbol: 'LSPAD',
      uri: input.uri,
      sellerFeeBasisPoints: percentAmount(0),
      isMutable: false,
      creators: none(),
      collection: input.collectionMintAddress
        ? some({
            verified: false,
            key: publicKey(input.collectionMintAddress),
          })
        : none(),
      printSupply: some(printSupply('Limited', [input.maxCopies])),
    });

    if (input.collectionMintAddress) {
      const collection = this.getCollectionAccounts(
        umi,
        input.collectionMintAddress,
      );

      builder = builder.add(
        setAndVerifySizedCollectionItem(umi, {
          metadata,
          collectionAuthority: umi.identity,
          collectionMint: collection.collectionMint,
          collection: collection.collectionMetadata,
          collectionMasterEditionAccount: collection.collectionMasterEdition,
        }),
      );
    }

    const result = await builder.sendAndConfirm(umi, {
      confirm: {
        commitment: this.getConfirmationCommitment(),
      },
    });
    const signature = signatureToBase58(result.signature);
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      masterMintAddress: toWeb3JsPublicKey(masterMint.publicKey).toBase58(),
      metadataAddress: toWeb3JsPublicKey(metadata[0]).toBase58(),
      masterEditionAddress: toWeb3JsPublicKey(masterEdition[0]).toBase58(),
      collectionMintAddress: input.collectionMintAddress ?? null,
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
    };
  }

  async createBookCollectionAsset(input: {
    name: string;
    uri: string;
  }): Promise<CollectionAsset> {
    const { umi } = this.createUmiWithTreasury();
    const collectionMint = generateSigner(umi);
    const metadata = findMetadataPda(umi, {
      mint: collectionMint.publicKey,
    });
    const masterEdition = findMasterEditionPda(umi, {
      mint: collectionMint.publicKey,
    });

    const result = await createNft(umi, {
      mint: collectionMint,
      name: input.name.slice(0, 32),
      symbol: 'LSPAD',
      uri: input.uri,
      sellerFeeBasisPoints: percentAmount(0),
      isMutable: true,
      creators: none(),
      collection: none(),
      isCollection: true,
      collectionDetails: some(collectionDetails('V1', { size: 0 })),
      printSupply: some(printSupply('Zero')),
    }).sendAndConfirm(umi, {
      confirm: {
        commitment: this.getConfirmationCommitment(),
      },
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
    };
  }

  async attachNftToCollection(input: {
    nftMetadataAddress: string;
    collectionMintAddress: string;
  }) {
    const { umi } = this.createUmiWithTreasury();
    const collection = this.getCollectionAccounts(
      umi,
      input.collectionMintAddress,
    );

    const result = await setAndVerifySizedCollectionItem(umi, {
      metadata: publicKey(input.nftMetadataAddress),
      collectionAuthority: umi.identity,
      collectionMint: collection.collectionMint,
      collection: collection.collectionMetadata,
      collectionMasterEditionAccount: collection.collectionMasterEdition,
    }).sendAndConfirm(umi, {
      confirm: {
        commitment: this.getConfirmationCommitment(),
      },
    });
    const signature = signatureToBase58(result.signature);
    const meta = await this.getSlotAndBlockTime(signature);

    return {
      signature,
      confirmationSlot: meta.slot,
      blockTime: meta.blockTime,
    };
  }

  async mintChapterAsset(input: {
    masterMintAddress: string;
    destinationWalletAddress: string;
    editionNumber: number;
    collectionMintAddress?: string | null;
  }): Promise<MintedAsset> {
    const destination = new PublicKey(input.destinationWalletAddress);
    const { umi } = this.createUmiWithTreasury();
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

    if (input.collectionMintAddress) {
      const collection = this.getCollectionAccounts(
        umi,
        input.collectionMintAddress,
      );

      builder = builder.add(
        setAndVerifySizedCollectionItem(umi, {
          metadata,
          collectionAuthority: umi.identity,
          collectionMint: collection.collectionMint,
          collection: collection.collectionMetadata,
          collectionMasterEditionAccount: collection.collectionMasterEdition,
        }),
      );
    }

    const result = await builder.sendAndConfirm(umi, {
      confirm: {
        commitment: this.getConfirmationCommitment(),
      },
    });
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
