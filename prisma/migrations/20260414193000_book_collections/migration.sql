ALTER TABLE "Book"
  ADD COLUMN IF NOT EXISTS "collectionMintAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "collectionMetadataAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "collectionMasterEditionAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "collectionMetadataProvider" "MetadataStorageProvider",
  ADD COLUMN IF NOT EXISTS "collectionMetadataCid" TEXT,
  ADD COLUMN IF NOT EXISTS "collectionMetadataUri" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Book_collectionMintAddress_key"
  ON "Book"("collectionMintAddress");

CREATE UNIQUE INDEX IF NOT EXISTS "Book_collectionMetadataAddress_key"
  ON "Book"("collectionMetadataAddress");

CREATE UNIQUE INDEX IF NOT EXISTS "Book_collectionMasterEditionAddress_key"
  ON "Book"("collectionMasterEditionAddress");
