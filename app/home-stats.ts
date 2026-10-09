// What the Home page shows about the last 30 days of code use. Pure, so it can be tested without a database.

export const STATS_WINDOW_DAYS = 30;

export interface RedemptionRow {
  orderId: string;
  code: string;
  totalPrice: number;
  currency: string;
}

export interface RecentCodeStats {
  /** Orders in the window that used at least one of the app's codes. */
  orders: number;
  /** Order totals, one entry per currency, most orders first. */
  sales: { currency: string; total: number; orders: number }[];
  /** The code used on the most orders, if any. */
  topCode: { code: string; orders: number } | null;
}

/** An order with two of the app's codes appears once in the counts and the sales. */
export function summarizeRedemptions(rows: RedemptionRow[]): RecentCodeStats {
  const orders = new Map<string, { currency: string; total: number }>();
  const codeOrders = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!orders.has(r.orderId)) orders.set(r.orderId, { currency: r.currency, total: r.totalPrice });
    const set = codeOrders.get(r.code) ?? new Set<string>();
    set.add(r.orderId);
    codeOrders.set(r.code, set);
  }

  const byCurrency = new Map<string, { total: number; orders: number }>();
  for (const o of orders.values()) {
    const cur = byCurrency.get(o.currency) ?? { total: 0, orders: 0 };
    cur.total += o.total;
    cur.orders += 1;
    byCurrency.set(o.currency, cur);
  }
  const sales = [...byCurrency.entries()]
    .map(([currency, v]) => ({ currency, total: v.total, orders: v.orders }))
    .sort((a, b) => b.orders - a.orders);

  let topCode: RecentCodeStats["topCode"] = null;
  for (const [code, set] of codeOrders) {
    if (!topCode || set.size > topCode.orders) topCode = { code, orders: set.size };
  }

  return { orders: orders.size, sales, topCode };
}

/** "$1,234.50", or "1,234.50 XYZ" if the currency code isn't one the browser knows. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
