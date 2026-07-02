CREATE TABLE "BlockedProductType" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedProductType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlockedProductType_shop_productType_key" ON "BlockedProductType"("shop", "productType");
CREATE INDEX "BlockedProductType_shop_idx" ON "BlockedProductType"("shop");
