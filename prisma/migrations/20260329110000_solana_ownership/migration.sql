DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChainWalletCustodyType') THEN
    CREATE TYPE "ChainWalletCustodyType" AS ENUM ('CUSTODIAL', 'EXTERNAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WithdrawalDestinationType') THEN
    CREATE TYPE "WithdrawalDestinationType" AS ENUM ('BANK', 'SOLANA_WALLET');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnchainTransactionType') THEN
    CREATE TYPE "OnchainTransactionType" AS ENUM ('METADATA_CREATE', 'PURCHASE_PAYMENT', 'CHAPTER_MINT', 'WITHDRAWAL', 'OWNERSHIP_SYNC');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnchainTransactionStatus') THEN
    CREATE TYPE "OnchainTransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');
  END IF;
END $$;

ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'MINT_FEE';

ALTER TABLE "AnalyticsSnapshot"
  ADD COLUMN IF NOT EXISTS "revenueInUsdcMinor" INTEGER NOT NULL DEFAULT 0;
UPDATE "AnalyticsSnapshot"
SET "revenueInUsdcMinor" = GREATEST(COALESCE("revenueInKobo", 0) * 1000, 0);
ALTER TABLE "AnalyticsSnapshot"
  DROP COLUMN IF EXISTS "revenueInKobo";

ALTER TABLE "Chapter"
  ADD COLUMN IF NOT EXISTS "publishedRevision" INTEGER NOT NULL DEFAULT 0;
UPDATE "Chapter"
SET "publishedRevision" = CASE
  WHEN "publishedAt" IS NOT NULL THEN GREATEST("publishedRevision", 1)
  ELSE "publishedRevision"
END;

ALTER TABLE "LibraryItem"
  ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);

ALTER TABLE "Offer"
  ADD COLUMN IF NOT EXISTS "chapterId" TEXT,
  ADD COLUMN IF NOT EXISTS "priceInUsdcMinor" INTEGER NOT NULL DEFAULT 0;
UPDATE "Offer"
SET "priceInUsdcMinor" = GREATEST(COALESCE("priceInKobo", 0) * 1000, 500000);
UPDATE "Offer" AS offer
SET "chapterId" = chapter."id"
FROM "Chapter" AS chapter
WHERE offer."bookId" = chapter."bookId"
  AND offer."type" = 'SINGLE_CHAPTER'
  AND offer."chapterStart" = offer."chapterEnd"
  AND offer."chapterStart" = chapter."chapterNumber";
ALTER TABLE "Offer"
  ALTER COLUMN "currency" SET DEFAULT 'USDC';
ALTER TABLE "Offer"
  DROP COLUMN IF EXISTS "priceInKobo";

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "payerWalletAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientWalletAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "totalAmountInUsdcMinor" INTEGER NOT NULL DEFAULT 0;
UPDATE "Order"
SET "totalAmountInUsdcMinor" = GREATEST(COALESCE("totalAmountInKobo", 0) * 1000, 0);
ALTER TABLE "Order"
  ALTER COLUMN "currency" SET DEFAULT 'USDC';
ALTER TABLE "Order"
  DROP COLUMN IF EXISTS "totalAmountInKobo";

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "amountInUsdcMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "chapterEditionId" TEXT,
  ADD COLUMN IF NOT EXISTS "chapterId" TEXT;
UPDATE "OrderItem"
SET "amountInUsdcMinor" = GREATEST(COALESCE("amountInKobo", 0) * 1000, 0);
UPDATE "OrderItem" AS item
SET "chapterId" = offer."chapterId"
FROM "Offer" AS offer
WHERE item."offerId" = offer."id";
ALTER TABLE "OrderItem"
  DROP COLUMN IF EXISTS "amountInKobo";

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "amountInUsdcMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "chainTxSignature" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmationSlot" INTEGER,
  ADD COLUMN IF NOT EXISTS "payerWalletAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientWalletAddress" TEXT;
UPDATE "Payment"
SET "amountInUsdcMinor" = GREATEST(COALESCE("amountInKobo", 0) * 1000, 0);
ALTER TABLE "Payment"
  ALTER COLUMN "currency" SET DEFAULT 'USDC',
  ALTER COLUMN "provider" SET DEFAULT 'SOLANA_USDC';
ALTER TABLE "Payment"
  DROP COLUMN IF EXISTS "amountInKobo";

ALTER TABLE "PayoutAccount"
  ADD COLUMN IF NOT EXISTS "destinationType" "WithdrawalDestinationType" NOT NULL DEFAULT 'BANK',
  ADD COLUMN IF NOT EXISTS "label" TEXT,
  ADD COLUMN IF NOT EXISTS "walletAddress" TEXT;
UPDATE "PayoutAccount"
SET "label" = COALESCE("label", NULLIF("bankName", ''), 'Primary destination');
ALTER TABLE "PayoutAccount"
  ALTER COLUMN "label" SET NOT NULL,
  ALTER COLUMN "bankName" DROP NOT NULL,
  ALTER COLUMN "accountName" DROP NOT NULL,
  ALTER COLUMN "accountNumberMasked" DROP NOT NULL,
  ALTER COLUMN "provider" DROP NOT NULL;

ALTER TABLE "PayoutRequest"
  ADD COLUMN IF NOT EXISTS "amountInUsdcMinor" INTEGER NOT NULL DEFAULT 0;
UPDATE "PayoutRequest"
SET "amountInUsdcMinor" = GREATEST(COALESCE("amountInKobo", 0) * 1000, 0);
ALTER TABLE "PayoutRequest"
  DROP COLUMN IF EXISTS "amountInKobo";

ALTER TABLE "Wallet"
  ADD COLUMN IF NOT EXISTS "availableBalanceInUsdcMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pendingBalanceInUsdcMinor" INTEGER NOT NULL DEFAULT 0;
UPDATE "Wallet"
SET
  "availableBalanceInUsdcMinor" = GREATEST(COALESCE("availableBalanceInKobo", 0) * 1000, 0),
  "pendingBalanceInUsdcMinor" = GREATEST(COALESCE("pendingBalanceInKobo", 0) * 1000, 0);
ALTER TABLE "Wallet"
  DROP COLUMN IF EXISTS "availableBalanceInKobo",
  DROP COLUMN IF EXISTS "pendingBalanceInKobo";

ALTER TABLE "WalletTransaction"
  ADD COLUMN IF NOT EXISTS "amountInUsdcMinor" INTEGER NOT NULL DEFAULT 0;
UPDATE "WalletTransaction"
SET "amountInUsdcMinor" = COALESCE("amountInKobo", 0) * 1000;
ALTER TABLE "WalletTransaction"
  DROP COLUMN IF EXISTS "amountInKobo";

CREATE TABLE IF NOT EXISTS "UserChainWallet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "custodyType" "ChainWalletCustodyType" NOT NULL,
  "encryptedPrivateKey" TEXT,
  "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isCreatorPayoutWallet" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserChainWallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChapterEdition" (
  "id" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "masterMintAddress" TEXT NOT NULL,
  "metadataAddress" TEXT NOT NULL,
  "collectionMintAddress" TEXT,
  "maxCopies" INTEGER NOT NULL,
  "mintedCopies" INTEGER NOT NULL DEFAULT 0,
  "priceInUsdcMinor" INTEGER NOT NULL,
  "sellerWalletAddress" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "ipfsCid" TEXT NOT NULL,
  "publishedRevisionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChapterEdition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChapterToken" (
  "id" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "editionId" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "ownerWalletId" TEXT,
  "mintAddress" TEXT NOT NULL,
  "tokenAccountAddress" TEXT NOT NULL,
  "ownerWalletAddress" TEXT NOT NULL,
  "serialNumber" INTEGER NOT NULL,
  "mintTxSignature" TEXT NOT NULL,
  "currentOwnershipVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChapterToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EncryptedChapterBlob" (
  "id" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "ipfsCid" TEXT NOT NULL,
  "encryptedContentKey" TEXT NOT NULL,
  "encryptedPayloadBase64" TEXT NOT NULL,
  "cipherSpec" TEXT NOT NULL,
  "plaintextHash" TEXT NOT NULL,
  "metadataJson" JSONB,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncryptedChapterBlob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OwnershipVerificationCache" (
  "id" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "chapterTokenMint" TEXT NOT NULL,
  "verifiedOwner" BOOLEAN NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnershipVerificationCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseReservation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "chapterEditionId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "fulfilledAt" TIMESTAMP(3),
  CONSTRAINT "PurchaseReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OnchainTransaction" (
  "id" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "txType" "OnchainTransactionType" NOT NULL,
  "status" "OnchainTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "errorPayload" JSONB,
  "userId" TEXT,
  "bookId" TEXT,
  "chapterId" TEXT,
  "orderId" TEXT,
  "paymentId" TEXT,
  "payoutRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnchainTransaction_pkey" PRIMARY KEY ("id")
);

INSERT INTO "UserChainWallet" (
  "id",
  "userId",
  "address",
  "label",
  "custodyType",
  "encryptedPrivateKey",
  "isDefault",
  "isActive",
  "isCreatorPayoutWallet",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-wallet-' || substring(md5("User"."id") from 1 for 24),
  "User"."id",
  'legacy-wallet-' || substring(md5("User"."email") from 1 for 32),
  'Lesenpad custodial wallet',
  'CUSTODIAL'::"ChainWalletCustodyType",
  NULL,
  true,
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE NOT EXISTS (
  SELECT 1 FROM "UserChainWallet" wallet WHERE wallet."userId" = "User"."id"
);

INSERT INTO "ChapterEdition" (
  "id",
  "chapterId",
  "masterMintAddress",
  "metadataAddress",
  "collectionMintAddress",
  "maxCopies",
  "mintedCopies",
  "priceInUsdcMinor",
  "sellerWalletAddress",
  "isActive",
  "ipfsCid",
  "publishedRevisionHash",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-edition-' || substring(md5(chapter."id") from 1 for 20),
  chapter."id",
  'legacy-master-' || substring(md5(chapter."id" || '-master') from 1 for 32),
  'legacy-meta-' || substring(md5(chapter."id" || '-meta') from 1 for 32),
  'legacy-collection-' || substring(md5(chapter."bookId") from 1 for 32),
  240,
  0,
  GREATEST(COALESCE(offer."priceInUsdcMinor", 1250000), 500000),
  wallet."address",
  true,
  'legacy-cid-' || substring(md5(chapter."id" || '-cid') from 1 for 40),
  md5(chapter."id" || ':' || chapter."publishedRevision"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Chapter" chapter
JOIN "Book" book
  ON book."id" = chapter."bookId"
JOIN "UserChainWallet" wallet
  ON wallet."userId" = book."authorId" AND wallet."isDefault" = true
LEFT JOIN "Offer" offer
  ON offer."chapterId" = chapter."id"
WHERE chapter."publishedAt" IS NOT NULL
  AND chapter."isFree" = false
  AND NOT EXISTS (
    SELECT 1 FROM "ChapterEdition" edition WHERE edition."chapterId" = chapter."id"
  );

WITH legacy_mints AS (
  SELECT DISTINCT ON (entitlement."userId", chapter."id")
    'legacy-token-' || substring(md5(entitlement."id" || ':' || chapter."id") from 1 for 24) AS id,
    chapter."id" AS "chapterId",
    edition."id" AS "editionId",
    entitlement."userId" AS "ownerUserId",
    wallet."id" AS "ownerWalletId",
    wallet."address" AS "ownerWalletAddress",
    'legacy-mint-' || substring(md5(entitlement."id" || ':mint:' || chapter."id") from 1 for 32) AS "mintAddress",
    'legacy-token-account-' || substring(md5(entitlement."id" || ':token:' || chapter."id") from 1 for 28) AS "tokenAccountAddress",
    ROW_NUMBER() OVER (
      PARTITION BY chapter."id"
      ORDER BY entitlement."grantedAt", entitlement."id"
    ) AS "serialNumber",
    'legacy-mint-tx-' || substring(md5(entitlement."id" || ':tx:' || chapter."id") from 1 for 28) AS "mintTxSignature",
    entitlement."grantedAt" AS "createdAt"
  FROM "Entitlement" entitlement
  JOIN "Chapter" chapter
    ON chapter."bookId" = entitlement."bookId"
   AND (
     entitlement."fullBook" = true OR (
       entitlement."chapterStart" IS NOT NULL
       AND entitlement."chapterEnd" IS NOT NULL
       AND chapter."chapterNumber" BETWEEN entitlement."chapterStart" AND entitlement."chapterEnd"
     )
   )
  JOIN "ChapterEdition" edition
    ON edition."chapterId" = chapter."id"
  JOIN "UserChainWallet" wallet
    ON wallet."userId" = entitlement."userId" AND wallet."isDefault" = true
  WHERE chapter."isFree" = false
)
INSERT INTO "ChapterToken" (
  "id",
  "chapterId",
  "editionId",
  "ownerUserId",
  "ownerWalletId",
  "ownerWalletAddress",
  "mintAddress",
  "tokenAccountAddress",
  "serialNumber",
  "mintTxSignature",
  "currentOwnershipVerifiedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  id,
  "chapterId",
  "editionId",
  "ownerUserId",
  "ownerWalletId",
  "ownerWalletAddress",
  "mintAddress",
  "tokenAccountAddress",
  "serialNumber",
  "mintTxSignature",
  CURRENT_TIMESTAMP,
  "createdAt",
  CURRENT_TIMESTAMP
FROM legacy_mints
WHERE NOT EXISTS (
  SELECT 1 FROM "ChapterToken" token WHERE token."id" = legacy_mints.id
);

UPDATE "ChapterEdition" edition
SET "mintedCopies" = counts.token_count
FROM (
  SELECT "editionId", COUNT(*)::INTEGER AS token_count
  FROM "ChapterToken"
  GROUP BY "editionId"
) counts
WHERE counts."editionId" = edition."id";

UPDATE "OrderItem" item
SET "chapterEditionId" = edition."id"
FROM "ChapterEdition" edition
WHERE item."chapterId" = edition."chapterId";

CREATE UNIQUE INDEX IF NOT EXISTS "UserChainWallet_address_key" ON "UserChainWallet"("address");
CREATE INDEX IF NOT EXISTS "UserChainWallet_userId_isDefault_idx" ON "UserChainWallet"("userId", "isDefault");
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterEdition_chapterId_key" ON "ChapterEdition"("chapterId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterEdition_masterMintAddress_key" ON "ChapterEdition"("masterMintAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterEdition_metadataAddress_key" ON "ChapterEdition"("metadataAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterToken_mintAddress_key" ON "ChapterToken"("mintAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterToken_tokenAccountAddress_key" ON "ChapterToken"("tokenAccountAddress");
CREATE INDEX IF NOT EXISTS "ChapterToken_ownerUserId_chapterId_idx" ON "ChapterToken"("ownerUserId", "chapterId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterToken_editionId_serialNumber_key" ON "ChapterToken"("editionId", "serialNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "EncryptedChapterBlob_ipfsCid_key" ON "EncryptedChapterBlob"("ipfsCid");
CREATE UNIQUE INDEX IF NOT EXISTS "EncryptedChapterBlob_chapterId_revision_key" ON "EncryptedChapterBlob"("chapterId", "revision");
CREATE INDEX IF NOT EXISTS "OwnershipVerificationCache_expiresAt_idx" ON "OwnershipVerificationCache"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "OwnershipVerificationCache_walletAddress_chapterTokenMint_key" ON "OwnershipVerificationCache"("walletAddress", "chapterTokenMint");
CREATE INDEX IF NOT EXISTS "PurchaseReservation_expiresAt_idx" ON "PurchaseReservation"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReservation_orderId_chapterEditionId_key" ON "PurchaseReservation"("orderId", "chapterEditionId");
CREATE UNIQUE INDEX IF NOT EXISTS "OnchainTransaction_signature_key" ON "OnchainTransaction"("signature");
CREATE INDEX IF NOT EXISTS "OnchainTransaction_userId_txType_idx" ON "OnchainTransaction"("userId", "txType");
CREATE UNIQUE INDEX IF NOT EXISTS "Offer_chapterId_key" ON "Offer"("chapterId");

ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_chapterEditionId_fkey"
  FOREIGN KEY ("chapterEditionId") REFERENCES "ChapterEdition"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserChainWallet"
  ADD CONSTRAINT "UserChainWallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChapterEdition"
  ADD CONSTRAINT "ChapterEdition_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChapterToken"
  ADD CONSTRAINT "ChapterToken_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChapterToken"
  ADD CONSTRAINT "ChapterToken_editionId_fkey"
  FOREIGN KEY ("editionId") REFERENCES "ChapterEdition"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChapterToken"
  ADD CONSTRAINT "ChapterToken_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChapterToken"
  ADD CONSTRAINT "ChapterToken_ownerWalletId_fkey"
  FOREIGN KEY ("ownerWalletId") REFERENCES "UserChainWallet"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EncryptedChapterBlob"
  ADD CONSTRAINT "EncryptedChapterBlob_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReservation"
  ADD CONSTRAINT "PurchaseReservation_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReservation"
  ADD CONSTRAINT "PurchaseReservation_chapterEditionId_fkey"
  FOREIGN KEY ("chapterEditionId") REFERENCES "ChapterEdition"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnchainTransaction"
  ADD CONSTRAINT "OnchainTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnchainTransaction"
  ADD CONSTRAINT "OnchainTransaction_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "Book"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnchainTransaction"
  ADD CONSTRAINT "OnchainTransaction_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnchainTransaction"
  ADD CONSTRAINT "OnchainTransaction_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnchainTransaction"
  ADD CONSTRAINT "OnchainTransaction_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnchainTransaction"
  ADD CONSTRAINT "OnchainTransaction_payoutRequestId_fkey"
  FOREIGN KEY ("payoutRequestId") REFERENCES "PayoutRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
