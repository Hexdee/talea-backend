import 'dotenv/config';
import { google } from 'googleapis';
import { mkdirSync, createReadStream, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

type BackupConfig = {
  databaseUrl: string;
  folderId: string;
  serviceAccountFile?: string;
  serviceAccountJson?: string;
};

function printUsage() {
  console.log(
    [
      'Usage:',
      '  pnpm db:backup:drive',
      '',
      'Required env:',
      '  DATABASE_URL',
      '  GOOGLE_DRIVE_BACKUP_FOLDER_ID',
      '  GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE or GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON',
      '',
      'Notes:',
      '  Requires pg_dump to be installed on the host.',
      '  Uploads a custom-format PostgreSQL dump to Google Drive.',
    ].join('\n'),
  );
}

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

function getConfig(): BackupConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID?.trim();
  const serviceAccountFile =
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE?.trim() || undefined;
  const serviceAccountJson =
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim() || undefined;

  if (!databaseUrl || !folderId) {
    printUsage();
    throw new Error(
      'DATABASE_URL and GOOGLE_DRIVE_BACKUP_FOLDER_ID are required.',
    );
  }

  if (!serviceAccountFile && !serviceAccountJson) {
    printUsage();
    throw new Error(
      'Set GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE or GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.',
    );
  }

  return {
    databaseUrl,
    folderId,
    serviceAccountFile,
    serviceAccountJson,
  };
}

function runPgDump(databaseUrl: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        outputPath,
        '--dbname',
        databaseUrl,
      ],
      {
        stdio: 'inherit',
      },
    );

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`pg_dump exited with code ${code ?? 'unknown'}.`));
    });
  });
}

async function createDriveClient(config: BackupConfig) {
  const auth = config.serviceAccountFile
    ? new google.auth.GoogleAuth({
        keyFile: config.serviceAccountFile,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      })
    : new google.auth.GoogleAuth({
        credentials: JSON.parse(config.serviceAccountJson ?? '{}'),
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });

  return google.drive({
    version: 'v3',
    auth,
  });
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  const config = getConfig();
  const workDir = join(tmpdir(), 'lesenpad-db-backups');
  mkdirSync(workDir, { recursive: true });

  const dumpPath = join(workDir, `lesenpad-${randomUUID()}.dump`);
  const backupName = `lesenpad-db-${new Date().toISOString().replaceAll(':', '-')}.dump`;

  try {
    await runPgDump(config.databaseUrl, dumpPath);

    const drive = await createDriveClient(config);
    const response = await drive.files.create({
      requestBody: {
        name: backupName,
        parents: [config.folderId],
      },
      media: {
        mimeType: 'application/octet-stream',
        body: createReadStream(dumpPath),
      },
      fields: 'id, webViewLink, name',
    });

    console.log(
      JSON.stringify(
        {
          fileId: response.data.id,
          name: response.data.name,
          webViewLink: response.data.webViewLink,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      unlinkSync(dumpPath);
    } catch {
      // Ignore cleanup errors.
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error.';
  console.error(message);
  process.exitCode = 1;
});
