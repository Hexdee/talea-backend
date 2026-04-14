DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EncryptedStorageProvider') THEN
    CREATE TYPE "EncryptedStorageProvider" AS ENUM ('IPFS', 'ZEROG');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MetadataStorageProvider') THEN
    CREATE TYPE "MetadataStorageProvider" AS ENUM ('IPFS');
  END IF;
END $$;

ALTER TABLE "ChapterEdition" ADD COLUMN IF NOT EXISTS "metadataProvider" "MetadataStorageProvider" NOT NULL DEFAULT 'IPFS';
ALTER TABLE "ChapterEdition" ADD COLUMN IF NOT EXISTS "metadataCid" TEXT;

ALTER TABLE "EncryptedChapterBlob" ADD COLUMN IF NOT EXISTS "storageProvider" "EncryptedStorageProvider" NOT NULL DEFAULT 'IPFS';
ALTER TABLE "EncryptedChapterBlob" ADD COLUMN IF NOT EXISTS "storageRootHash" TEXT;
ALTER TABLE "EncryptedChapterBlob" ADD COLUMN IF NOT EXISTS "storageRetrievalUrl" TEXT;
