/**
 * Shopify's discount link: opening it saves the code and applies it at
 * checkout. `redirect` (optional) is where the shopper lands first.
 */

/** A path like "/collections/sale". Accepts a full store URL too; returns "" if blank. */
export function normalizeLandingPath(input: string): string {
  const text = input.trim();
  if (!text) return "";
  let path = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      path = `${url.pathname}${url.search}`;
    } catch {
      return "";
    }
  }
  return path.startsWith("/") ? path : `/${path}`;
}

/** `storeUrl` is the shop's primary domain URL, e.g. "https://example.com". */
export function buildDiscountLink(storeUrl: string, code: string, landing = ""): string {
  const base = storeUrl.replace(/\/+$/, "");
  const link = `${base}/discount/${encodeURIComponent(code)}`;
  const path = normalizeLandingPath(landing);
  if (!path || path === "/") return link;
  return `${link}?redirect=${encodeURIComponent(path).replace(/%2F/g, "/")}`;
}
