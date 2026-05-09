import 'dotenv/config';

import {
  createNft,
  findMetadataPda,
  mplTokenMetadata,
  verifyCollectionV1,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  percentAmount,
  some,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { Keypair } from '@solana/web3.js';

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
      { cause: error as Error },
    );
  }
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL is not set.');

  const treasurySecret = process.env.SOLANA_TREASURY_SECRET_KEY;
  if (!treasurySecret) throw new Error('SOLANA_TREASURY_SECRET_KEY is not set.');

  const authority = Keypair.fromSecretKey(
    parseSecretKey(treasurySecret, 'SOLANA_TREASURY_SECRET_KEY'),
  );

  const umi = createUmi(rpcUrl).use(mplTokenMetadata());
  umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

  console.log(`RPC: ${rpcUrl}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);

  // 1) Create collection NFT.
  const collectionMint = generateSigner(umi);
  console.log(`\nCreating collection mint: ${collectionMint.publicKey}`);

  await createNft(umi, {
    mint: collectionMint,
    name: 'Docs Collection',
    uri: 'https://example.com/collection.json',
    sellerFeeBasisPoints: percentAmount(0),
    isCollection: true,
  }).sendAndConfirm(umi, {
    send: { commitment: 'finalized' },
    confirm: { commitment: 'finalized' },
  });

  // 2) Create asset NFT with unverified collection reference.
  const assetMint = generateSigner(umi);
  console.log(`\nCreating asset mint: ${assetMint.publicKey}`);

  await createNft(umi, {
    mint: assetMint,
    name: 'Docs Asset',
    uri: 'https://example.com/asset.json',
    sellerFeeBasisPoints: percentAmount(0),
    collection: some({ key: collectionMint.publicKey, verified: false }),
  }).sendAndConfirm(umi, {
    send: { commitment: 'finalized' },
    confirm: { commitment: 'finalized' },
  });

  // 3) Verify.
  const metadata = findMetadataPda(umi, { mint: assetMint.publicKey });
  console.log(`\nVerifying collection...`);
  await verifyCollectionV1(umi, {
    metadata,
    collectionMint: collectionMint.publicKey,
    authority: umi.identity,
  }).sendAndConfirm(umi, {
    send: { commitment: 'finalized' },
    confirm: { commitment: 'finalized' },
  });

  console.log(`\nOK: Collection verified on asset`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
