-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "genre" TEXT NOT NULL DEFAULT 'General Fiction',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
