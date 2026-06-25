ALTER TABLE "UserChainWallet"
ADD COLUMN IF NOT EXISTS "providerWalletId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "UserChainWallet_providerWalletId_key"
ON "UserChainWallet"("providerWalletId");
