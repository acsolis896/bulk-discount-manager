// Deletes personal-data-bearing rows that are past their retention period.
// Run on a schedule (e.g. a daily Railway cron service): node scripts/retention.mjs
// Pass --dry-run to print counts without deleting.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const days = (name, fallback) => Number(process.env[name] ?? fallback);
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function main() {
  const redemptionCutoff = daysAgo(days("RETENTION_REDEMPTION_DAYS", 730));
  const accessLogCutoff = daysAgo(days("RETENTION_ACCESS_LOG_DAYS", 365));

  // Per-customer usage counts only matter while their reusable code exists.
  const liveCodes = await prisma.singleCodeDiscount.findMany({ select: { shop: true, discountId: true } });
  const liveKeys = new Set(liveCodes.map((c) => `${c.shop}|${c.discountId}`));
  const usageRows = await prisma.codeUsageCount.findMany({ select: { id: true, shop: true, discountId: true } });
  const orphanUsageIds = usageRows.filter((r) => !liveKeys.has(`${r.shop}|${r.discountId}`)).map((r) => r.id);

  const counts = {
    orphanedUsageCounts: orphanUsageIds.length,
    oldRedemptions: await prisma.codeRedemption.count({ where: { createdAt: { lt: redemptionCutoff } } }),
    oldAccessLogs: await prisma.personalDataAccessLog.count({ where: { createdAt: { lt: accessLogCutoff } } }),
  };
  console.log(JSON.stringify({ dryRun, redemptionCutoff, accessLogCutoff, counts }));
  if (dryRun) return;

  await prisma.codeUsageCount.deleteMany({ where: { id: { in: orphanUsageIds } } });
  await prisma.codeRedemption.deleteMany({ where: { createdAt: { lt: redemptionCutoff } } });
  await prisma.personalDataAccessLog.deleteMany({ where: { createdAt: { lt: accessLogCutoff } } });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
