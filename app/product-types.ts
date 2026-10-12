/** Marks the "Other" choice in the product type dropdown, where the merchant types a name instead. */
export const OTHER_PRODUCT_TYPE = "__other__";

/**
 * The store's product types a merchant can still choose: blanks and repeats removed, anything already
 * blocked left out (compared without regard to case, like the checkout matching), sorted A to Z.
 */
export function pickableProductTypes(storeTypes: string[], blockedTypes: string[]): string[] {
  const blocked = new Set(blockedTypes.map((t) => t.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of storeTypes) {
    const type = raw.trim();
    const key = type.toLowerCase();
    if (!type || blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(type);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
