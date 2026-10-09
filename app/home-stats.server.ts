import db from "./db.server";
import { STATS_WINDOW_DAYS, summarizeRedemptions, type RecentCodeStats } from "./home-stats";

// A guard for very busy stores: the Home page only needs a summary, not every order.
const MAX_ROWS = 20000;

/** Orders that used this shop's codes in the last 30 days, from the app's own order ledger. */
export async function getRecentCodeStats(shop: string, now: Date = new Date()): Promise<RecentCodeStats> {
  const since = new Date(now.getTime() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.codeRedemption.findMany({
    where: { shop, createdAt: { gte: since } },
    select: { orderId: true, code: true, totalPrice: true, currency: true },
    take: MAX_ROWS,
  });
  return summarizeRedemptions(rows);
}
