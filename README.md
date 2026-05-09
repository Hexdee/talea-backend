# Lesenpad Backend

Production NestJS API for Lesenpad.

- Host target: Fly.io
- Database: PostgreSQL
- ORM: Prisma
- Swagger docs: `/docs`
- Payment provider mode: Solana devnet USDC

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
   EMAILS_ENABLED=true
   RESEND_API_KEY=re_xxxxxxxxx
   RESEND_FROM_EMAIL=Lesenpad <onboarding@resend.dev>
   CHAIN_MASTER_KEY=replace-with-a-stable-local-secret
   SOLANA_NETWORK=devnet
   SOLANA_RPC_URL=https://api.devnet.solana.com
   SOLANA_USDC_MINT_ADDRESS=replace-with-devnet-usdc-mint
   SOLANA_TREASURY_SECRET_KEY=replace-with-json-array-or-base64-secret-key
   SOLANA_CONFIRMATION_COMMITMENT=confirmed
   PINATA_JWT=replace-with-pinata-jwt
   IPFS_GATEWAY_BASE=https://gateway.pinata.cloud
   ```

   `SOLANA_TREASURY_SECRET_KEY` must be the fee-paying treasury keypair secret
   encoded as either a JSON byte array or base64. Keep `CHAIN_MASTER_KEY`
   stable after publishing encrypted chapters, otherwise old encrypted chapter
   blobs cannot be decrypted. Public covers/editor media now upload to R2,
   and both paid encrypted chapter payloads and NFT metadata JSON now upload to
   Pinata/IPFS. Set `EMAILS_ENABLED=true` and a valid `RESEND_API_KEY` to send
   transactional emails from signup/purchase/withdraw flows.

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

## Notes

- Google OAuth is wired, but local login works without Google secrets.
- Existing local `/uploads` assets are still served for backward compatibility,
  but new covers and editor media upload to R2.
- The frontend repo lives in the sibling folder `/Users/hexdee/projects/new project/talea`.
