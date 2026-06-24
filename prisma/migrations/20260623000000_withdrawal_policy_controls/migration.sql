-- Withdrawal policy and allowlist controls for custodial mainnet launch.

CREATE TABLE "WithdrawalPolicy" (
    "id" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "requireAllowlistedWallets" BOOLEAN NOT NULL DEFAULT false,
    "manualApprovalThresholdInUsdcMinor" INTEGER NOT NULL DEFAULT 100000000,
    "maxSingleWithdrawalInUsdcMinor" INTEGER NOT NULL DEFAULT 100000000,
    "maxRequestsPerDayPerWallet" INTEGER NOT NULL DEFAULT 5,
    "maxAmountPerDayPerWalletInUsdcMinor" INTEGER NOT NULL DEFAULT 500000000,
    "maxRequestsPerDayGlobal" INTEGER NOT NULL DEFAULT 50,
    "maxAmountPerDayGlobalInUsdcMinor" INTEGER NOT NULL DEFAULT 2000000000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalPolicy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WithdrawalPolicy_isEnabled_idx" ON "WithdrawalPolicy"("isEnabled");

CREATE TABLE "WithdrawalAllowlistEntry" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalAllowlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WithdrawalAllowlistEntry_walletAddress_key" ON "WithdrawalAllowlistEntry"("walletAddress");
CREATE INDEX "WithdrawalAllowlistEntry_isActive_idx" ON "WithdrawalAllowlistEntry"("isActive");
