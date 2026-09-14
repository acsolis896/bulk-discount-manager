-- AlterTable
ALTER TABLE "SingleCodeDiscount" ADD COLUMN "usesPerCustomerLimit" INTEGER;

-- CreateTable
CREATE TABLE "CodeUsageCount" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeUsageCount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodeUsageCount_shop_discountId_customerId_key" ON "CodeUsageCount"("shop", "discountId", "customerId");
CREATE INDEX "CodeUsageCount_shop_discountId_idx" ON "CodeUsageCount"("shop", "discountId");
