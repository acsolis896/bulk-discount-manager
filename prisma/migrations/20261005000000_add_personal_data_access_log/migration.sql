-- CreateTable
CREATE TABLE "PersonalDataAccessLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalDataAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalDataAccessLog_shop_createdAt_idx" ON "PersonalDataAccessLog"("shop", "createdAt");
CREATE INDEX "PersonalDataAccessLog_createdAt_idx" ON "PersonalDataAccessLog"("createdAt");
