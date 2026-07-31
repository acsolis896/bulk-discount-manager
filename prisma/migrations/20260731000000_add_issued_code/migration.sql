CREATE TABLE "IssuedCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IssuedCode_shop_code_key" ON "IssuedCode"("shop", "code");

CREATE INDEX "IssuedCode_shop_discountId_idx" ON "IssuedCode"("shop", "discountId");
