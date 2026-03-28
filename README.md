# Talea Backend

Production NestJS API for Talea.

- Host target: Fly.io
- Database: PostgreSQL
- ORM: Prisma
- Swagger docs: `/docs`
- Payment provider mode: demo only

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
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/talea?schema=public
   FRONTEND_ORIGIN=http://localhost:3000
   ```

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

- Reader: `reader@talea.dev` / `readerpass123`
- Author: `nora@talea.dev` / `authorpass123`

## Reset local database if needed

If your local schema drifts during development:

```bash
dropdb talea
createdb talea
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
- Uploaded covers and editor media are stored locally in `uploads/`.
- The frontend repo lives in the sibling folder `/Users/hexdee/projects/new project/talea`.
