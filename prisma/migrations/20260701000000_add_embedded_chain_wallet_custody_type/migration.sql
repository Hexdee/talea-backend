-- Add the non-custodial embedded wallet enum value required by Crossmint.
ALTER TYPE "ChainWalletCustodyType" ADD VALUE IF NOT EXISTS 'EMBEDDED';
