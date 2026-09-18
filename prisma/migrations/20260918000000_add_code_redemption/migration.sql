-- CreateTable
CREATE TABLE "CodeRedemption" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodeRedemption_shop_orderId_code_key" ON "CodeRedemption"("shop", "orderId", "code");
CREATE INDEX "CodeRedemption_shop_discountId_idx" ON "CodeRedemption"("shop", "discountId");
CREATE INDEX "CodeRedemption_shop_code_idx" ON "CodeRedemption"("shop", "code");
