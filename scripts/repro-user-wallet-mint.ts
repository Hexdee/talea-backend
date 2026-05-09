import 'dotenv/config';

import {
  approveCollectionAuthority,
  createNft,
  fetchMetadata,
  findCollectionAuthorityRecordPda,
  findMasterEditionPda,
  findMetadataPda,
  mplTokenMetadata,
  printSupply,
  printV1,
  safeFetchMetadata,
  setAndVerifySizedCollectionItem,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  isSome,
  keypairIdentity,
  keypairPayer,
  none,
  percentAmount,
  publicKey,
  some,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

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

  const network = process.env.SOLANA_NETWORK ?? '(unset)';
  const treasury = Keypair.fromSecretKey(
    parseSecretKey(treasurySecret, 'SOLANA_TREASURY_SECRET_KEY'),
  );

  // "User wallet" identity (author) signs authority actions.
  // Treasury pays for fees/rent.
  const author = treasury;
  const buyer = Keypair.generate();

  const umi = createUmi(rpcUrl).use(mplTokenMetadata());
  umi.use(keypairIdentity(fromWeb3JsKeypair(author), false));
  umi.use(keypairPayer(fromWeb3JsKeypair(treasury)));
  const connection = new Connection(rpcUrl, 'confirmed');

  console.log(`Network: ${network}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Treasury payer: ${treasury.publicKey.toBase58()}`);
  console.log(`Author identity: ${author.publicKey.toBase58()}`);
  console.log(`Buyer wallet: ${buyer.publicKey.toBase58()}`);

  // Ensure the author has an on-chain system account (some programs expect it).
  // Fund it from the treasury instead of relying on airdrops.
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: author.publicKey,
        lamports: 0.01 * 1e9,
      }),
    ),
    [treasury],
    { commitment: 'confirmed' },
  );

  const collectionMint = generateSigner(umi);
  const collectionMetadata = findMetadataPda(umi, {
    mint: collectionMint.publicKey,
  });
  const collectionMasterEdition = findMasterEditionPda(umi, {
    mint: collectionMint.publicKey,
  });
  console.log(`\nCreating collection: ${collectionMint.publicKey}`);
  await createNft(umi, {
    mint: collectionMint,
    name: 'Repro Collection',
    symbol: 'LSPAD',
    uri: 'https://example.com/collection.json',
    sellerFeeBasisPoints: percentAmount(0),
    creators: none(),
    collection: none(),
    isCollection: true,
  }).sendAndConfirm(umi);

  // Give devnet a moment to propagate accounts before fetching.
  await new Promise((resolve) => setTimeout(resolve, 800));

  const masterMint = generateSigner(umi);
  const masterMetadata = findMetadataPda(umi, { mint: masterMint.publicKey });
  console.log(`\nCreating chapter master: ${masterMint.publicKey}`);
  await createNft(umi, {
    mint: masterMint,
    name: 'Repro Chapter',
    symbol: 'LSPAD',
    uri: 'https://example.com/chapter.json',
    sellerFeeBasisPoints: percentAmount(0),
    creators: none(),
    printSupply: some(printSupply('Limited', [10])),
  }).sendAndConfirm(umi);

  await new Promise((resolve) => setTimeout(resolve, 800));

  await dumpOwners(connection, [
    { label: 'treasury payer', address: treasury.publicKey.toBase58() },
    { label: 'author identity', address: author.publicKey.toBase58() },
    { label: 'collection mint', address: String(collectionMint.publicKey) },
    { label: 'collection metadata', address: String(collectionMetadata[0]) },
    {
      label: 'collection master edition',
      address: String(collectionMasterEdition[0]),
    },
    { label: 'master mint', address: String(masterMint.publicKey) },
    { label: 'master metadata', address: String(masterMetadata[0]) },
  ]);

  const fetchedCollectionMetadata = await safeFetchMetadata(
    umi,
    collectionMetadata,
  );
  console.log(
    `\nCollection updateAuthority: ${
      fetchedCollectionMetadata?.updateAuthority ?? '(unavailable)'
    }`,
  );

  const fetchedMasterMetadata = await safeFetchMetadata(umi, masterMetadata);
  console.log(
    `Master updateAuthority: ${
      fetchedMasterMetadata?.updateAuthority ?? '(unavailable)'
    }`,
  );

  const strictCollectionMetadata = await fetchMetadata(umi, collectionMetadata, {
    commitment: 'confirmed',
  });
  const strictMasterMetadata = await fetchMetadata(umi, masterMetadata, {
    commitment: 'confirmed',
  });
  console.log(
    `Strict collection updateAuthority: ${strictCollectionMetadata.updateAuthority}`,
  );
  console.log(`Strict master updateAuthority: ${strictMasterMetadata.updateAuthority}`);
  console.log(`Strict collection tokenStandard: ${strictCollectionMetadata.tokenStandard}`);
  console.log(`Strict master tokenStandard: ${strictMasterMetadata.tokenStandard}`);
  console.log(
    `Strict collection tokenStandard (json): ${JSON.stringify(
      strictCollectionMetadata.tokenStandard,
    )}`,
  );
  console.log(
    `Strict master tokenStandard (json): ${JSON.stringify(
      strictMasterMetadata.tokenStandard,
    )}`,
  );
  console.log(
    `Strict collectionDetails: ${
      isSome(strictCollectionMetadata.collectionDetails)
        ? strictCollectionMetadata.collectionDetails.value.__kind
        : '(none)'
    }`,
  );

  console.log(`\nSetting + verifying sized collection...`);
  const collectionAuthorityRecord = findCollectionAuthorityRecordPda(umi, {
    mint: collectionMint.publicKey,
    collectionAuthority: umi.identity.publicKey,
  });
  console.log(`Approving collection authority record: ${collectionAuthorityRecord[0]}`);
  await approveCollectionAuthority(umi, {
    mint: collectionMint.publicKey,
    newCollectionAuthority: umi.identity.publicKey,
    collectionAuthorityRecord,
    updateAuthority: umi.identity,
    rent: publicKey('SysvarRent111111111111111111111111111111111'),
  }).sendAndConfirm(umi);

  await setAndVerifySizedCollectionItem(umi, {
    metadata: masterMetadata,
    collectionAuthority: umi.identity,
    updateAuthority: umi.identity.publicKey,
    collectionMint: collectionMint.publicKey,
    collection: collectionMetadata,
    collectionMasterEditionAccount: collectionMasterEdition,
    collectionAuthorityRecord,
  }).sendAndConfirm(umi);

  const onchainMasterMetadata = await safeFetchMetadata(umi, masterMetadata);
  if (!onchainMasterMetadata) {
    throw new Error('Master metadata not found after mint.');
  }
  console.log(`\nMaster metadata: ${onchainMasterMetadata.publicKey}`);
  console.log(
    `Master collection set: ${
      isSome(onchainMasterMetadata.collection)
        ? onchainMasterMetadata.collection.value.key
        : '(none)'
    }`,
  );
  console.log(
    `Master collection verified: ${
      isSome(onchainMasterMetadata.collection)
        ? onchainMasterMetadata.collection.value.verified
        : '(n/a)'
    }`,
  );

  console.log(`\nPrinting edition #1 to buyer...`);
  const editionMint = generateSigner(umi);
  await printV1(umi, {
    editionMint,
    editionTokenAccountOwner: publicKey(buyer.publicKey.toBase58()),
    masterEditionMint: masterMint.publicKey,
    tokenStandard: TokenStandard.NonFungible,
    editionNumber: 1,
  }).sendAndConfirm(umi);
  console.log(`Edition mint: ${editionMint.publicKey}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function dumpOwners(
  connection: Connection,
  accounts: Array<{ label: string; address: string }>,
) {
  console.log('\nAccount owners:');
  for (const account of accounts) {
    const pubkey = new PublicKey(account.address);
    const info = await connection.getAccountInfo(pubkey, 'confirmed');
    if (!info) {
      console.log(`- ${account.label}: ${account.address} (missing)`);
      continue;
    }
    console.log(
      `- ${account.label}: ${account.address} owner=${info.owner.toBase58()} dataLen=${info.data.length}`,
    );
  }
}

// (Removed verifyCollectionV1Compat; prefer testing the SDK builder first.)
