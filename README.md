# Lesenpad Backend

Production NestJS API for Lesenpad.

- Host target: Fly.io
- Database: PostgreSQL
- ORM: Prisma
- Swagger docs: `/docs`
- Payment provider mode: Solana mainnet USDC in production, devnet locally

## Requirements

- Node.js 20+
- `pnpm` 10+
- PostgreSQL running locally on `localhost:5432`

## Run locally

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create a local env file:

   ```bash
   cp .env.example .env
   ```

3. If you do not already have PostgreSQL running locally, start it with Docker:

   ```bash
   docker compose up -d
   ```

4. Make sure `.env` contains at least:

   ```env
   NODE_ENV=development
   PORT=4000
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lesenpad?schema=public
   FRONTEND_ORIGIN=http://localhost:3000
   MEDIA_STORAGE_PROVIDER=r2
   R2_BUCKET=replace-with-r2-bucket-name
   R2_PUBLIC_BASE_URL=https://cdn.example.com
   R2_ACCESS_KEY_ID=replace-with-r2-access-key-id
   R2_SECRET_ACCESS_KEY=replace-with-r2-secret-access-key
   R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
   WALLET_PROVIDER=solana
   RISK_DAILY_PURCHASE_LIMIT_USDC_MINOR=200000000
   RISK_DAILY_WITHDRAWAL_LIMIT_USDC_MINOR=500000000
   RISK_PER_MINUTE_REQUEST_LIMIT=20
   RISK_BLOCKED_WALLET_ADDRESSES=
   RISK_MANUAL_APPROVAL_THRESHOLD_USDC_MINOR=100000000
   RISK_MAX_SINGLE_WITHDRAWAL_USDC_MINOR=100000000
   RISK_MAX_REQUESTS_PER_DAY_PER_WALLET=5
   RISK_MAX_AMOUNT_PER_DAY_PER_WALLET_USDC_MINOR=500000000
   RISK_MAX_REQUESTS_PER_DAY_GLOBAL=50
   RISK_MAX_AMOUNT_PER_DAY_GLOBAL_USDC_MINOR=2000000000
   EMAILS_ENABLED=true
   RESEND_API_KEY=re_xxxxxxxxx
   RESEND_FROM_EMAIL=Lesenpad <onboarding@resend.dev>
   CHAIN_MASTER_KEY=replace-with-a-stable-local-secret
   SOLANA_TREASURY_SECRET_SOURCE=file
   SOLANA_NETWORK=devnet
   SOLANA_RPC_URL=https://api.devnet.solana.com
   SOLANA_USDC_MINT_ADDRESS=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
   SOLANA_TREASURY_SECRET_KEY=replace-with-json-array-or-base64-secret-key
   SOLANA_TREASURY_SECRET_KEY_FILE=
   HASHICORP_VAULT_ADDR=
   HASHICORP_VAULT_NAMESPACE=
   HASHICORP_VAULT_TOKEN=
   HASHICORP_VAULT_TOKEN_FILE=
   HASHICORP_VAULT_SECRET_PATH=
   HASHICORP_VAULT_SECRET_FIELD=secret
   SOLANA_CONFIRMATION_COMMITMENT=confirmed
   PINATA_JWT=replace-with-pinata-jwt
   IPFS_GATEWAY_BASE=https://gateway.pinata.cloud
   ```

   For local development, `SOLANA_TREASURY_SECRET_KEY` can be a JSON byte array
   or base64-encoded secret key. In production, you can keep using an env-file
   or set `SOLANA_TREASURY_SECRET_SOURCE=file` and point
   `SOLANA_TREASURY_SECRET_KEY_FILE` at the mounted secret. `env` remains
   available if you are explicitly exporting the secret into the runtime
   environment. Vault support is still available, but you do not need it for
   the current setup.

   Keep `CHAIN_MASTER_KEY` stable after publishing encrypted chapters,
   otherwise old encrypted chapter blobs cannot be decrypted. Public
   covers/editor media upload to R2, and both paid encrypted chapter payloads
   and NFT metadata JSON upload to Pinata/IPFS. Set `EMAILS_ENABLED=true` and a
   valid `RESEND_API_KEY` to send transactional emails from
   signup/purchase/withdraw flows.

5. Generate the Prisma client:

   ```bash
   pnpm prisma:generate
   ```

6. Apply migrations:

   ```bash
   pnpm prisma:migrate:deploy
   ```

7. Seed the database:

   ```bash
   pnpm prisma:seed
   ```

8. Start the backend:

   ```bash
   pnpm start:dev
   ```

   Start the reconciliation worker in a second terminal:

   ```bash
   pnpm start:worker:dev
   ```

9. Open the local services:
   - API: [http://localhost:4000](http://localhost:4000)
   - Health: [http://localhost:4000/v1/health](http://localhost:4000/v1/health)
   - Swagger: [http://localhost:4000/docs](http://localhost:4000/docs)

## Demo accounts after seeding

- Reader: `reader@lesenpad.dev` / `readerpass123`
- Author: `nora@lesenpad.dev` / `authorpass123`

## Reset local database if needed

If your local schema drifts during development:

```bash
dropdb lesenpad
createdb lesenpad
pnpm prisma:migrate:deploy
pnpm prisma:seed
```

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Ops Helpers

- Clear a development or staging database:

  ```bash
  pnpm db:clear -- --yes
  ```

- Create a fresh Solana wallet keypair:

  ```bash
  pnpm wallet:create -- --format base64
  ```

- Create a JSON secret file for a wallet:

  ```bash
  pnpm wallet:create -- --format json --out /tmp/solana-wallet.json
  ```

- Back up the database to Google Drive:

  ```bash
  pnpm db:backup:drive
  ```

  Required env:

  ```env
  GOOGLE_DRIVE_BACKUP_FOLDER_ID=replace-with-drive-folder-id
  GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json
  ```

  Or:

  ```env
  GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
  ```

## Admin controls

- Visit `/admin` as an `ADMIN` or `SUPERADMIN` user to manage:
  - Featured books
  - Withdrawal policy thresholds and allowlist
  - Payout recovery and manual approval
  - Reconciliation and finance exports

## Mainnet launch notes

- The treasury secret may come from:
  - `SOLANA_TREASURY_SECRET_KEY` when exporting env vars directly
  - `SOLANA_TREASURY_SECRET_KEY_FILE` when using a mounted file
  - Vault, if you decide to turn it back on later
- The withdrawal policy is persisted in Postgres and should be reviewed
  before mainnet launch. Default limits are seeded from the risk env values
  above on first run.

## Notes

- Google OAuth is wired, but local login works without Google secrets.
- Existing local `/uploads` assets are still served for backward compatibility,
  but new covers and editor media upload to R2.
- The frontend repo lives in the sibling folder `/Users/hexdee/projects/new project/talea`.
- Production should run the API and reconciliation worker as separate
  always-on processes.
