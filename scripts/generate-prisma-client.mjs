import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  'postgresql://prisma:prisma@127.0.0.1:5432/prisma_generate';

const result = spawnSync(process.execPath, [prismaCli, 'generate'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
  },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
