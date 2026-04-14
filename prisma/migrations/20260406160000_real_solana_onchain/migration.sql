ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'DEPOSIT';
ALTER TYPE "OnchainTransactionType" ADD VALUE IF NOT EXISTS 'MASTER_EDITION_CREATE';
ALTER TYPE "OnchainTransactionType" ADD VALUE IF NOT EXISTS 'USDC_TRANSFER';
ALTER TYPE "OnchainTransactionType" ADD VALUE IF NOT EXISTS 'PRINT_EDITION_MINT';
ALTER TYPE "OnchainTransactionType" ADD VALUE IF NOT EXISTS 'DEPOSIT';

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "buyerTokenAccountAddress" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "treasuryTokenAccountAddress" TEXT;

ALTER TABLE "UserChainWallet" ADD COLUMN IF NOT EXISTS "usdcTokenAccountAddress" TEXT;
ALTER TABLE "UserChainWallet" ADD COLUMN IF NOT EXISTS "lastObservedUsdcBalanceMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserChainWallet" ADD COLUMN IF NOT EXISTS "lastDepositSignature" TEXT;

ALTER TABLE "ChapterEdition" ADD COLUMN IF NOT EXISTS "masterEditionAddress" TEXT;
ALTER TABLE "ChapterEdition" ADD COLUMN IF NOT EXISTS "metadataUri" TEXT;

ALTER TABLE "ChapterToken" ADD COLUMN IF NOT EXISTS "editionAddress" TEXT;
ALTER TABLE "ChapterToken" ADD COLUMN IF NOT EXISTS "editionMetadataAddress" TEXT;

ALTER TABLE "OnchainTransaction" ADD COLUMN IF NOT EXISTS "slot" INTEGER;
ALTER TABLE "OnchainTransaction" ADD COLUMN IF NOT EXISTS "blockTime" TIMESTAMP(3);
ALTER TABLE "OnchainTransaction" ADD COLUMN IF NOT EXISTS "confirmationCommitment" TEXT;
ALTER TABLE "OnchainTransaction" ADD COLUMN IF NOT EXISTS "metadataJson" JSONB;
