import { PrismaClient } from '@prisma/client';
import {
  mplTokenMetadata,
  safeFetchMasterEdition,
  safeFetchMetadata,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata';
import { isSome, publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { MintLayout } from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';

function argValue(name: string) {
  const index = process.argv.findIndex((value) => value === `--${name}`);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function formatLamports(lamports: number) {
  return `${lamports} lamports (${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL)`;
}

function parseSecretKey(value: string, label: string) {
  const trimmed = value.trim();

  try {
    if (trimmed.startsWith('[')) {
      return Uint8Array.from(JSON.parse(trimmed) as number[]);
    }

    return Uint8Array.from(Buffer.from(trimmed, 'base64'));
  } catch (error) {
    throw new Error(
      `${label} must be a JSON byte array or base64-encoded secret key.`,
      {
        cause: error as Error,
      },
    );
  }
}

async function getAccountSummary(
  connection: Connection,
  address?: string | null,
) {
  if (!address) {
    return { address: null, exists: false };
  }

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
  } catch {
    return { address, exists: false, error: 'Invalid public key' as const };
  }

  const info = await connection.getAccountInfo(pubkey, 'confirmed');
  if (!info) {
    return { address, exists: false };
  }

  return {
    address,
    exists: true,
    owner: info.owner.toBase58(),
    lamports: info.lamports,
    dataLen: info.data.length,
    executable: info.executable,
  };
}

async function getMintSummary(connection: Connection, address?: string | null) {
  if (!address) {
    return { address: null, exists: false };
  }

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
  } catch {
    return { address, exists: false, error: 'Invalid public key' as const };
  }

  const info = await connection.getAccountInfo(pubkey, 'confirmed');
  if (!info) {
    return { address, exists: false };
  }

  if (info.data.length !== MintLayout.span) {
    return {
      address,
      exists: true,
      owner: info.owner.toBase58(),
      lamports: info.lamports,
      dataLen: info.data.length,
      executable: info.executable,
      mint: null,
      note: `Unexpected mint account size (expected ${MintLayout.span}).`,
    };
  }

  const decoded = MintLayout.decode(info.data);

  return {
    address,
    exists: true,
    owner: info.owner.toBase58(),
    lamports: info.lamports,
    dataLen: info.data.length,
    executable: info.executable,
    mint: {
      decimals: decoded.decimals,
      isInitialized: decoded.isInitialized,
      mintAuthority: decoded.mintAuthorityOption
        ? new PublicKey(decoded.mintAuthority).toBase58()
        : null,
      freezeAuthority: decoded.freezeAuthorityOption
        ? new PublicKey(decoded.freezeAuthority).toBase58()
        : null,
      supply: decoded.supply.toString(),
    },
  };
}

function deriveMetadataPda(
  metaplexTokenMetadataProgram: PublicKey,
  mint: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      metaplexTokenMetadataProgram.toBuffer(),
      mint.toBuffer(),
    ],
    metaplexTokenMetadataProgram,
  )[0];
}

function deriveMasterEditionPda(
  metaplexTokenMetadataProgram: PublicKey,
  mint: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      metaplexTokenMetadataProgram.toBuffer(),
      mint.toBuffer(),
      Buffer.from('edition'),
    ],
    metaplexTokenMetadataProgram,
  )[0];
}

function deriveCollectionAuthorityRecordPda(
  metaplexTokenMetadataProgram: PublicKey,
  collectionMint: PublicKey,
  collectionAuthority: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      metaplexTokenMetadataProgram.toBuffer(),
      collectionMint.toBuffer(),
      Buffer.from('collection_authority'),
      collectionAuthority.toBuffer(),
    ],
    metaplexTokenMetadataProgram,
  )[0];
}

async function main() {
  const slug = argValue('slug');
  const bookId = argValue('bookId');
  const chapterId = argValue('chapterId');

  if (!slug && !bookId && !chapterId) {
    console.error(
      'Usage: pnpm exec ts-node --project tsconfig.json scripts/debug-collection.ts --slug <book-slug>\n' +
        '   or: pnpm exec ts-node --project tsconfig.json scripts/debug-collection.ts --bookId <book-id>\n' +
        '   or: pnpm exec ts-node --project tsconfig.json scripts/debug-collection.ts --chapterId <chapter-id>',
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error('SOLANA_RPC_URL is not set.');
  }

  const network = process.env.SOLANA_NETWORK ?? '(unset)';
  const commitment = (process.env.SOLANA_CONFIRMATION_COMMITMENT ??
    'confirmed') as 'processed' | 'confirmed' | 'finalized';

  const connection = new Connection(rpcUrl, commitment);
  const prisma = new PrismaClient();
  const umi = createUmi(rpcUrl).use(mplTokenMetadata());

  const metaplexTokenMetadataProgram = new PublicKey(
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  );
  const tokenProgram = new PublicKey(
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  );

  const chapter = chapterId
    ? await prisma.chapter.findUnique({
        where: { id: chapterId },
        include: { book: true, edition: true },
      })
    : null;

  const book = chapter?.book
    ? chapter.book
    : slug
      ? await prisma.book.findUnique({
          where: { slug },
          include: { author: true },
        })
      : bookId
        ? await prisma.book.findUnique({
            where: { id: bookId },
            include: { author: true },
          })
        : null;

  if (!book) {
    throw new Error('Book not found.');
  }

  console.log('--- Environment ---');
  console.log({
    SOLANA_NETWORK: network,
    SOLANA_RPC_URL: rpcUrl,
    SOLANA_CONFIRMATION_COMMITMENT: commitment,
  });

  try {
    const genesis = await connection.getGenesisHash();
    console.log({ genesisHash: genesis });
  } catch {
    // ignore
  }

  console.log('\n--- Book (DB) ---');
  console.log({
    id: book.id,
    slug: book.slug,
    title: book.title,
    status: book.status,
    authorId: book.authorId,
    collectionMintAddress: book.collectionMintAddress,
    collectionMetadataAddress: book.collectionMetadataAddress,
    collectionMasterEditionAddress: book.collectionMasterEditionAddress,
    collectionMetadataUri: book.collectionMetadataUri,
  });

  // Derive expected PDAs from collection mint.
  let expectedMetadataPda: string | null = null;
  let expectedMasterEditionPda: string | null = null;
  if (book.collectionMintAddress) {
    const mint = new PublicKey(book.collectionMintAddress);
    expectedMetadataPda = deriveMetadataPda(
      metaplexTokenMetadataProgram,
      mint,
    ).toBase58();
    expectedMasterEditionPda = deriveMasterEditionPda(
      metaplexTokenMetadataProgram,
      mint,
    ).toBase58();
  }

  console.log('\n--- Collection (Derived PDAs) ---');
  console.log({
    expectedCollectionMetadataPda: expectedMetadataPda,
    expectedCollectionMasterEditionPda: expectedMasterEditionPda,
    matchesStoredMetadata:
      Boolean(expectedMetadataPda && book.collectionMetadataAddress) &&
      expectedMetadataPda === book.collectionMetadataAddress,
    matchesStoredMasterEdition:
      Boolean(
        expectedMasterEditionPda && book.collectionMasterEditionAddress,
      ) && expectedMasterEditionPda === book.collectionMasterEditionAddress,
  });

  console.log('\n--- On-chain Account Owners ---');
  const summaries = {
    collectionMint: await getMintSummary(
      connection,
      book.collectionMintAddress,
    ),
    collectionMetadata: await getAccountSummary(
      connection,
      book.collectionMetadataAddress,
    ),
    collectionMasterEdition: await getAccountSummary(
      connection,
      book.collectionMasterEditionAddress,
    ),
  };
  console.log(summaries);

  if (summaries.collectionMint.exists) {
    console.log('Expected mint owner:', tokenProgram.toBase58());
  }
  if (summaries.collectionMetadata.exists) {
    console.log(
      'Expected metadata owner:',
      metaplexTokenMetadataProgram.toBase58(),
    );
  }
  if (summaries.collectionMasterEdition.exists) {
    console.log(
      'Expected master edition owner:',
      metaplexTokenMetadataProgram.toBase58(),
    );
  }

  console.log('\n--- Token Metadata Decode (Collection) ---');
  try {
    const decodedCollectionMetadata = book.collectionMetadataAddress
      ? await safeFetchMetadata(umi, publicKey(book.collectionMetadataAddress))
      : null;
    const decodedCollectionMasterEdition = book.collectionMasterEditionAddress
      ? await safeFetchMasterEdition(
          umi,
          publicKey(book.collectionMasterEditionAddress),
        )
      : null;

    console.log({
      metadata: decodedCollectionMetadata
        ? {
            updateAuthority:
              decodedCollectionMetadata.updateAuthority.toString(),
            mint: decodedCollectionMetadata.mint.toString(),
            name: decodedCollectionMetadata.name,
            symbol: decodedCollectionMetadata.symbol,
            uri: decodedCollectionMetadata.uri,
            tokenStandard: isSome(decodedCollectionMetadata.tokenStandard)
              ? TokenStandard[decodedCollectionMetadata.tokenStandard.value]
              : null,
            collection: isSome(decodedCollectionMetadata.collection)
              ? {
                  verified: decodedCollectionMetadata.collection.value.verified,
                  key: decodedCollectionMetadata.collection.value.key.toString(),
                }
              : null,
            collectionDetails: isSome(
              decodedCollectionMetadata.collectionDetails,
            )
              ? decodedCollectionMetadata.collectionDetails.value.__kind
              : null,
          }
        : null,
      masterEdition: decodedCollectionMasterEdition
        ? {
            maxSupply: isSome(decodedCollectionMasterEdition.maxSupply)
              ? decodedCollectionMasterEdition.maxSupply.value.toString()
              : null,
            supply: decodedCollectionMasterEdition.supply.toString(),
          }
        : null,
    });
  } catch (error) {
    console.log({ error: (error as Error).message });
  }

  const treasurySecret = process.env.SOLANA_TREASURY_SECRET_KEY;
  if (treasurySecret && book.collectionMintAddress) {
    console.log('\n--- Treasury / Collection Authority ---');
    try {
      const treasury = Keypair.fromSecretKey(
        parseSecretKey(treasurySecret, 'SOLANA_TREASURY_SECRET_KEY'),
      );
      const balance = await connection.getBalance(
        treasury.publicKey,
        'confirmed',
      );
      const collectionAuthorityRecordPda = deriveCollectionAuthorityRecordPda(
        metaplexTokenMetadataProgram,
        new PublicKey(book.collectionMintAddress),
        treasury.publicKey,
      );

      console.log({
        treasuryPublicKey: treasury.publicKey.toBase58(),
        balance: formatLamports(balance),
        derivedCollectionAuthorityRecordPda:
          collectionAuthorityRecordPda.toBase58(),
      });
      console.log({
        collectionAuthorityRecord: await getAccountSummary(
          connection,
          collectionAuthorityRecordPda.toBase58(),
        ),
      });
    } catch (error) {
      console.log({ error: (error as Error).message });
    }
  }

  if (chapter) {
    console.log('\n--- Chapter (DB) ---');
    console.log({
      id: chapter.id,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      isFree: chapter.isFree,
      publishedAt: chapter.publishedAt,
      editionId: chapter.edition?.id ?? null,
      editionCollectionMintAddress:
        chapter.edition?.collectionMintAddress ?? null,
      editionMasterMintAddress: chapter.edition?.masterMintAddress ?? null,
      editionMetadataAddress: chapter.edition?.metadataAddress ?? null,
      editionMasterEditionAddress:
        chapter.edition?.masterEditionAddress ?? null,
    });

    if (chapter.edition?.masterMintAddress) {
      console.log('\n--- Chapter Edition (On-chain) ---');
      console.log({
        masterMint: await getMintSummary(
          connection,
          chapter.edition.masterMintAddress,
        ),
        metadata: await getAccountSummary(
          connection,
          chapter.edition.metadataAddress,
        ),
        masterEdition: await getAccountSummary(
          connection,
          chapter.edition.masterEditionAddress ?? null,
        ),
        expectedMetadataPda: deriveMetadataPda(
          metaplexTokenMetadataProgram,
          new PublicKey(chapter.edition.masterMintAddress),
        ).toBase58(),
        expectedMasterEditionPda: deriveMasterEditionPda(
          metaplexTokenMetadataProgram,
          new PublicKey(chapter.edition.masterMintAddress),
        ).toBase58(),
      });

      console.log('\n--- Token Metadata Decode (Chapter Edition) ---');
      try {
        const decodedEditionMetadata = await safeFetchMetadata(
          umi,
          publicKey(chapter.edition.metadataAddress),
        );
        console.log(
          decodedEditionMetadata
            ? {
                updateAuthority:
                  decodedEditionMetadata.updateAuthority.toString(),
                mint: decodedEditionMetadata.mint.toString(),
                name: decodedEditionMetadata.name,
                symbol: decodedEditionMetadata.symbol,
                uri: decodedEditionMetadata.uri,
                tokenStandard: isSome(decodedEditionMetadata.tokenStandard)
                  ? TokenStandard[decodedEditionMetadata.tokenStandard.value]
                  : null,
                collection: isSome(decodedEditionMetadata.collection)
                  ? {
                      verified:
                        decodedEditionMetadata.collection.value.verified,
                      key: decodedEditionMetadata.collection.value.key.toString(),
                    }
                  : null,
              }
            : null,
        );
      } catch (error) {
        console.log({ error: (error as Error).message });
      }
    }
  }

  await prisma.$disconnect();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
