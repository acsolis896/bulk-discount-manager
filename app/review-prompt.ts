const CREATION_COUNT_KEY = "bdm-discount-creation-count";

// Ask for a review starting on the merchant's 2nd successful discount
// creation (bulk or reusable), not their very first — so the ask follows a
// bit of proven value instead of a one-off action right after install.
// Shopify's own Reviews API still decides whether anything is actually
// shown (24h-since-install, 60-day cooldown, annual cap, etc).
export function shouldRequestReviewAfterCreation(): boolean {
  try {
    const count = Number(localStorage.getItem(CREATION_COUNT_KEY) || "0") + 1;
    localStorage.setItem(CREATION_COUNT_KEY, String(count));
    return count >= 2;
  } catch {
    return true;
  }
}
