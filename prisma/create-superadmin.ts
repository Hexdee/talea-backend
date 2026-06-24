import 'dotenv/config';
import { AuthAccountProvider, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

type ParsedArgs = {
  email?: string;
  password?: string;
  displayName?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    switch (token) {
      case '--email':
        parsed.email = next;
        index += 1;
        break;
      case '--password':
        parsed.password = next;
        index += 1;
        break;
      case '--display-name':
        parsed.displayName = next;
        index += 1;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        break;
    }
  }

  return parsed;
}

function printUsage() {
  console.log(
    [
      'Usage:',
      '  pnpm superadmin:create --email owner@example.com --password "strong-password" --display-name "Owner"',
      '',
      'Notes:',
      '  --email is required.',
      '  --password is required when creating a new local superadmin user.',
      '  If the user already exists, the command adds the ADMIN and SUPERADMIN roles.',
      '  If --password is provided for an existing local user, it resets the password.',
    ].join('\n'),
  );
}

function deriveDisplayName(email: string) {
  const base = email.split('@')[0] ?? 'Superadmin';

  return base
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mergeRoles(existingRoles: Role[]) {
  return Array.from(
    new Set([Role.USER, ...existingRoles, Role.ADMIN, Role.SUPERADMIN]),
  );
}

async function main() {
  const { email, password, displayName } = parseArgs(process.argv.slice(2));

  if (!email) {
    printUsage();
    throw new Error('Missing required --email argument.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    include: {
      authAccounts: true,
      wallet: true,
    },
  });

  if (!user && !password) {
    throw new Error(
      'A password is required to create a new superadmin user. Pass --password.',
    );
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;

  if (!user) {
    const created = await prisma.user.create({
      data: {
        email: normalizedEmail,
        displayName: displayName?.trim() || deriveDisplayName(normalizedEmail),
        roles: [Role.USER, Role.ADMIN, Role.SUPERADMIN],
        authAccounts: {
          create: {
            provider: AuthAccountProvider.LOCAL,
            providerAccountId: normalizedEmail,
            passwordHash,
          },
        },
        wallet: {
          create: {},
        },
      },
      include: {
        authAccounts: true,
      },
    });

    console.log(
      `Created superadmin user ${created.email} with roles: ${created.roles.join(', ')}`,
    );
    return;
  }

  const localAccount = user.authAccounts.find(
    (account) => account.provider === AuthAccountProvider.LOCAL,
  );

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      displayName: displayName?.trim() || undefined,
      roles: mergeRoles(user.roles),
      wallet: user.wallet
        ? undefined
        : {
            create: {},
          },
      authAccounts:
        passwordHash && !localAccount
          ? {
              create: {
                provider: AuthAccountProvider.LOCAL,
                providerAccountId: normalizedEmail,
                passwordHash,
              },
            }
          : undefined,
    },
  });

  if (passwordHash && localAccount) {
    await prisma.authAccount.update({
      where: {
        provider_providerAccountId: {
          provider: AuthAccountProvider.LOCAL,
          providerAccountId: normalizedEmail,
        },
      },
      data: {
        passwordHash,
      },
    });
  }

  console.log(
    [
      `Updated ${normalizedEmail}.`,
      'Roles ADMIN and SUPERADMIN are now enabled.',
      passwordHash
        ? 'Local password was created or updated.'
        : 'Password was left unchanged.',
    ].join(' '),
  );
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
