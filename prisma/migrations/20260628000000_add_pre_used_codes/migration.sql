CREATE TABLE "PreUsedCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreUsedCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreUsedCode_shop_code_key" ON "PreUsedCode"("shop", "code");
CREATE INDEX "PreUsedCode_shop_discountId_idx" ON "PreUsedCode"("shop", "discountId");
