-- Extend enums
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'WalletTransactionType' AND e.enumlabel = 'PURCHASE'
  ) THEN
    ALTER TYPE "WalletTransactionType" ADD VALUE 'PURCHASE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'WalletTransactionType' AND e.enumlabel = 'GAS_FEE'
  ) THEN
    ALTER TYPE "WalletTransactionType" ADD VALUE 'GAS_FEE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'PayoutRequestStatus' AND e.enumlabel = 'DEAD_LETTER'
  ) THEN
    ALTER TYPE "PayoutRequestStatus" ADD VALUE 'DEAD_LETTER';
  END IF;
END $$;

DO $$
BEGIN
  CREATE TYPE "LedgerEntryType" AS ENUM (
    'DEPOSIT_CREDIT',
    'PURCHASE_HOLD',
    'PURCHASE_DEBIT',
    'PURCHASE_RELEASE',
    'SALE_CREDIT',
    'WITHDRAWAL_HOLD',
    'WITHDRAWAL_DEBIT',
    'WITHDRAWAL_RELEASE',
    'GAS_FEE_DEBIT',
    'ADJUSTMENT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TransakOrderType" AS ENUM ('ONRAMP', 'OFFRAMP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TransakOrderStatus" AS ENUM ('CREATED', 'PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ledger journal
CREATE TABLE IF NOT EXISTS "LedgerJournal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "type" "LedgerEntryType" NOT NULL,
  "amountInUsdcMinor" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "availableBalanceAfterMinor" INTEGER NOT NULL,
  "pendingBalanceAfterMinor" INTEGER NOT NULL,
  "reference" TEXT,
  "description" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerJournal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LedgerJournal_idempotencyKey_key" ON "LedgerJournal"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "LedgerJournal_walletId_createdAt_idx" ON "LedgerJournal"("walletId", "createdAt");
CREATE INDEX IF NOT EXISTS "LedgerJournal_userId_createdAt_idx" ON "LedgerJournal"("userId", "createdAt");

ALTER TABLE "LedgerJournal"
  ADD CONSTRAINT "LedgerJournal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerJournal"
  ADD CONSTRAINT "LedgerJournal_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payout request controls
ALTER TABLE "PayoutRequest"
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deadLetterReason" TEXT,
  ADD COLUMN IF NOT EXISTS "externalReference" TEXT;

-- Transak tables
CREATE TABLE IF NOT EXISTS "TransakOrderIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletId" TEXT,
  "payoutRequestId" TEXT,
  "type" "TransakOrderType" NOT NULL,
  "status" "TransakOrderStatus" NOT NULL DEFAULT 'CREATED',
  "partnerOrderId" TEXT NOT NULL,
  "externalOrderId" TEXT,
  "fiatCurrency" TEXT,
  "fiatAmount" TEXT,
  "cryptoCurrency" TEXT NOT NULL DEFAULT 'USDC',
  "cryptoAmount" TEXT,
  "walletAddress" TEXT NOT NULL,
  "transactionHash" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastReconciledAt" TIMESTAMP(3),
  "lastError" TEXT,
  "payloadJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransakOrderIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TransakOrderIntent_partnerOrderId_key" ON "TransakOrderIntent"("partnerOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "TransakOrderIntent_externalOrderId_key" ON "TransakOrderIntent"("externalOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "TransakOrderIntent_payoutRequestId_key" ON "TransakOrderIntent"("payoutRequestId");
CREATE INDEX IF NOT EXISTS "TransakOrderIntent_userId_type_status_idx" ON "TransakOrderIntent"("userId", "type", "status");
CREATE INDEX IF NOT EXISTS "TransakOrderIntent_walletAddress_status_idx" ON "TransakOrderIntent"("walletAddress", "status");

ALTER TABLE "TransakOrderIntent"
  ADD CONSTRAINT "TransakOrderIntent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TransakOrderIntent"
  ADD CONSTRAINT "TransakOrderIntent_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TransakOrderIntent"
  ADD CONSTRAINT "TransakOrderIntent_payoutRequestId_fkey"
  FOREIGN KEY ("payoutRequestId") REFERENCES "PayoutRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "TransakWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "externalOrderId" TEXT,
  "partnerOrderId" TEXT,
  "eventType" TEXT,
  "status" TEXT,
  "signature" TEXT,
  "payloadJson" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransakWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TransakWebhookEvent_eventKey_key" ON "TransakWebhookEvent"("eventKey");
