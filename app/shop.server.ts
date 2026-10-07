import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/** The shop's own currency code (e.g. "AED"), or "" if it can't be read. Never throws. */
export async function getShopCurrencyCode(admin: AdminApiContext): Promise<string> {
  try {
    const res = await admin.graphql(`#graphql
      query ShopCurrencyCode {
        shop { currencyCode }
      }`);
    const data = (await res.json()) as { data?: { shop?: { currencyCode?: string } | null } };
    return data.data?.shop?.currencyCode ?? "";
  } catch {
    return "";
  }
}
