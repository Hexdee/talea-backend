import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { Connection, PublicKey } from '@solana/web3.js';
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
const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

function usage() {
  console.log(
    [
      'Usage:',
      '  pnpm exec ts-node --project tsconfig.json scripts/diagnose-chapter-publish.ts --chapter <chapterId>',
      '  pnpm exec ts-node --project tsconfig.json scripts/diagnose-chapter-publish.ts --book <bookSlugOrId> --chapterNumber <n>',
      '',
      'Validates the on-chain owners for the book collection + chapter edition accounts',
      'on the currently configured SOLANA_RPC_URL.',
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

function ownerLabel(owner?: PublicKey | null) {
  return owner ? owner.toBase58() : '(missing)';
}

async function checkAccount(
  connection: Connection,
  label: string,
  address?: string | null,
) {
  if (!address) {
    console.log(`${label}: (null)`);
    return { ok: false, reason: 'null' as const };
  }
  const pubkey = new PublicKey(address);
  const info = await connection.getAccountInfo(pubkey);
  console.log(`${label}: ${address}`);
  console.log(`  owner: ${ownerLabel(info?.owner ?? null)}`);
  console.log(`  exists: ${Boolean(info)}`);
  return { info, pubkey };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const network = process.env.SOLANA_NETWORK ?? 'devnet';
  const connection = new Connection(rpcUrl, 'confirmed');
  const prisma = new PrismaClient();

  try {
    let chapterId: string | null = null;
    if (typeof args.chapter === 'string') {
      chapterId = args.chapter;
    } else if (
      typeof args.book === 'string' &&
      typeof args.chapterNumber === 'string'
    ) {
      const chapterNumber = Number(args.chapterNumber);
      const chapter = await prisma.chapter.findFirst({
        where: {
          chapterNumber,
          book: { OR: [{ id: args.book }, { slug: args.book }] },
        },
        select: { id: true },
      });
      chapterId = chapter?.id ?? null;
    }

    if (!chapterId) {
      usage();
      throw new Error('Missing --chapter or --book + --chapterNumber.');
    }

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        book: true,
        edition: true,
      },
    });

    if (!chapter) {
      throw new Error(`Chapter not found: ${chapterId}`);
    }

    console.log(`Network: ${network}`);
    console.log(`RPC: ${rpcUrl}`);
    console.log(`Book: ${chapter.book.title} (${chapter.book.slug})`);
    console.log(`Chapter: ${chapter.chapterNumber} (${chapter.id})`);
    console.log('');

    console.log('Book collection (DB):');
    await checkAccount(
      connection,
      'collectionMintAddress',
      chapter.book.collectionMintAddress,
    );
    await checkAccount(
      connection,
      'collectionMetadataAddress',
      chapter.book.collectionMetadataAddress,
    );
    await checkAccount(
      connection,
      'collectionMasterEditionAddress',
      chapter.book.collectionMasterEditionAddress,
    );
    console.log('');

    if (chapter.book.collectionMintAddress) {
      const umi = createUmi(rpcUrl);
      const umiMint = umiPublicKey(chapter.book.collectionMintAddress);
      const derivedMetadata = findMetadataPda(umi, { mint: umiMint });
      const derivedEdition = findMasterEditionPda(umi, { mint: umiMint });
      const derivedMetadataAddress = toWeb3JsPublicKey(
        derivedMetadata[0],
      ).toBase58();
      const derivedEditionAddress = toWeb3JsPublicKey(
        derivedEdition[0],
      ).toBase58();
      console.log('Book collection (derived PDAs):');
      console.log(`derived metadata: ${derivedMetadataAddress}`);
      console.log(`derived master edition: ${derivedEditionAddress}`);
      console.log('');
    }

    console.log('Chapter edition (DB):');
    if (!chapter.edition) {
      console.log(
        '(none) — this chapter will call createChapterEditionAsset on publish',
      );
    } else {
      const mintInfo = await checkAccount(
        connection,
        'masterMintAddress',
        chapter.edition.masterMintAddress,
      );
      const metadataInfo = await checkAccount(
        connection,
        'metadataAddress',
        chapter.edition.metadataAddress,
      );
      await checkAccount(
        connection,
        'masterEditionAddress',
        chapter.edition.masterEditionAddress,
      );
      console.log(
        `collectionMintAddress (edition): ${chapter.edition.collectionMintAddress ?? '(null)'}`,
      );
      console.log('');

      const issues: string[] = [];
      if (mintInfo.info && !mintInfo.info.owner.equals(TOKEN_PROGRAM_ID)) {
        issues.push(
          `masterMintAddress owner is ${mintInfo.info.owner.toBase58()} (expected Tokenkeg).`,
        );
      }
      if (
        metadataInfo.info &&
        !metadataInfo.info.owner.equals(TOKEN_METADATA_PROGRAM_ID)
      ) {
        issues.push(
          `metadataAddress owner is ${metadataInfo.info.owner.toBase58()} (expected metaqbxx).`,
        );
      }
      if (issues.length) {
        console.log('Issues detected:');
        for (const issue of issues) console.log(`- ${issue}`);
        console.log('');
      }
    }

    console.log(
      'If publish fails with IncorrectOwner while collection is valid, the usual culprit is the chapter edition metadata/master edition address in DB (wrong cluster or stale record), or a flaky RPC where the collection accounts are not readable at verification time.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
