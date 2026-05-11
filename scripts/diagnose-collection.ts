import 'dotenv/config';

import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  findMasterEditionPda,
  findMetadataPda,
} from '@metaplex-foundation/mpl-token-metadata';
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
);

function usage() {
  console.log(
    [
      'Usage:',
      '  pnpm exec ts-node --project tsconfig.json scripts/diagnose-collection.ts --book <bookIdOrSlug>',
      '  pnpm exec ts-node --project tsconfig.json scripts/diagnose-collection.ts --collection <collectionMintAddress>',
      '',
      'Reads book.collectionMintAddress from the DB (or uses a provided collection mint)',
      'and validates that the derived token-metadata accounts exist and are owned by',
      'the Metaplex Token Metadata program on the currently configured RPC.',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith('--')) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = value;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.book && !args.collection)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const network = process.env.SOLANA_NETWORK ?? 'devnet';
  const connection = new Connection(rpcUrl, 'confirmed');

  const prisma = new PrismaClient();
  let collectionMintAddress: string | null = null;
  let bookRef: string | null = null;

  try {
    if (typeof args.collection === 'string') {
      collectionMintAddress = args.collection;
    } else if (typeof args.book === 'string') {
      bookRef = args.book;
      const book = await prisma.book.findFirst({
        where: {
          OR: [{ id: bookRef }, { slug: bookRef }],
        },
        select: {
          id: true,
          slug: true,
          collectionMintAddress: true,
          title: true,
        },
      });

      if (!book) {
        throw new Error(`Book not found for "${bookRef}".`);
      }

      collectionMintAddress = book.collectionMintAddress ?? null;
      console.log(
        `Book: ${book.title} (${book.slug})\\ncollectionMintAddress: ${collectionMintAddress ?? 'null'}`,
      );
    }

    if (!collectionMintAddress) {
      throw new Error(
        'No collectionMintAddress available. Create the book collection first or pass --collection.',
      );
    }

    const collectionMint = new PublicKey(collectionMintAddress);
    const umi = createUmi(rpcUrl);
    const umiMint = umiPublicKey(collectionMintAddress);
    const metadataPda = findMetadataPda(umi, { mint: umiMint });
    const masterEditionPda = findMasterEditionPda(umi, { mint: umiMint });

    const mintInfo = await connection.getAccountInfo(collectionMint);
    const metadataInfo = await connection.getAccountInfo(
      toWeb3JsPublicKey(metadataPda[0]),
    );
    const masterEditionInfo = await connection.getAccountInfo(
      toWeb3JsPublicKey(masterEditionPda[0]),
    );

    const fmtOwner = (info: typeof mintInfo) =>
      info ? info.owner.toBase58() : '(missing)';

    console.log('');
    console.log(`Network: ${network}`);
    console.log(`RPC: ${rpcUrl}`);
    console.log(`Collection mint: ${collectionMint.toBase58()}`);
    console.log(`Mint owner: ${fmtOwner(mintInfo)}`);
    console.log(
      `Metadata PDA: ${toWeb3JsPublicKey(metadataPda[0]).toBase58()}`,
    );
    console.log(`Metadata owner: ${fmtOwner(metadataInfo)}`);
    console.log(
      `Master edition PDA: ${toWeb3JsPublicKey(masterEditionPda[0]).toBase58()}`,
    );
    console.log(`Master edition owner: ${fmtOwner(masterEditionInfo)}`);
    console.log('');

    const issues: string[] = [];
    if (!mintInfo) {
      issues.push('Collection mint account is missing on this RPC/cluster.');
    }
    if (!metadataInfo) {
      issues.push(
        'Collection metadata account is missing on this RPC/cluster.',
      );
    } else if (!metadataInfo.owner.equals(TOKEN_METADATA_PROGRAM_ID)) {
      issues.push(
        `Collection metadata owner is ${metadataInfo.owner.toBase58()} (expected ${TOKEN_METADATA_PROGRAM_ID.toBase58()}).`,
      );
    }
    if (!masterEditionInfo) {
      issues.push(
        'Collection master edition account is missing on this RPC/cluster.',
      );
    } else if (!masterEditionInfo.owner.equals(TOKEN_METADATA_PROGRAM_ID)) {
      issues.push(
        `Collection master edition owner is ${masterEditionInfo.owner.toBase58()} (expected ${TOKEN_METADATA_PROGRAM_ID.toBase58()}).`,
      );
    }

    if (issues.length === 0) {
      console.log(
        'OK: collection looks valid for token-metadata verification.',
      );
      return;
    }

    console.log('Issues detected:');
    for (const issue of issues) {
      console.log(`- ${issue}`);
    }
    console.log('');
    console.log(
      'Likely cause of IncorrectOwner: book.collectionMintAddress is wrong for this cluster (devnet/mainnet mismatch) or points to a non-collection mint.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
