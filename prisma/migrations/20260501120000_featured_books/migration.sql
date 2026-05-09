-- CreateTable
CREATE TABLE "FeaturedBook" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturedBook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedBook_bookId_key" ON "FeaturedBook"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedBook_rank_key" ON "FeaturedBook"("rank");

-- CreateIndex
CREATE INDEX "FeaturedBook_rank_idx" ON "FeaturedBook"("rank");

-- AddForeignKey
ALTER TABLE "FeaturedBook" ADD CONSTRAINT "FeaturedBook_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

