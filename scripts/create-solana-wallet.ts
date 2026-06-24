import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';

type Format = 'base64' | 'json';

type ParsedArgs = {
  format: Format;
  out?: string;
};

function printUsage() {
  console.log(
    [
      'Usage:',
      '  pnpm wallet:create -- [--format base64|json] [--out /path/to/secret-file]',
      '',
      'Notes:',
      '  This creates a fresh Solana keypair and prints the public address.',
      '  Use base64 for Vault/KMS projections or json when a JSON byte array is required.',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { format: 'base64' };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    switch (token) {
      case '--format':
        if (next === 'json' || next === 'base64') {
          parsed.format = next;
          index += 1;
        }
        break;
      case '--out':
        if (next) {
          parsed.out = next;
          index += 1;
        }
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

function serializeSecret(keypair: Keypair, format: Format) {
  if (format === 'json') {
    return JSON.stringify(Array.from(keypair.secretKey), null, 2);
  }

  return Buffer.from(keypair.secretKey).toString('base64');
}

async function main() {
  const { format, out } = parseArgs(process.argv.slice(2));
  const keypair = Keypair.generate();
  const secret = serializeSecret(keypair, format);
  const payload = {
    address: keypair.publicKey.toBase58(),
    format,
    secret,
  };

  if (out) {
    const outputPath = resolve(out);
    writeFileSync(outputPath, `${secret}\n`, { encoding: 'utf8' });
    console.log(`Wrote ${format} secret to ${outputPath}`);
    console.log(`Address: ${payload.address}`);
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error.';
  console.error(message);
  process.exitCode = 1;
});
