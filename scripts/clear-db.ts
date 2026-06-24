import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function printUsage() {
  console.log(
    [
      'Usage:',
      '  pnpm db:clear -- --yes',
      '',
      'Notes:',
      '  This truncates all public schema tables except _prisma_migrations.',
      '  It is destructive and should only be used on development or staging databases.',
    ].join('\n'),
  );
}

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  if (!hasFlag('--yes')) {
    printUsage();
    throw new Error('Refusing to clear the database without --yes.');
  }

  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name ASC
  `;

  if (tables.length === 0) {
    console.log('No tables found to truncate.');
    return;
  }

  const tableList = tables
    .map((item) => quoteIdentifier(item.table_name))
    .join(', ');
  console.log(`Truncating ${tables.length} tables...`);
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`,
  );
  console.log('Database cleared.');
}

void main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
