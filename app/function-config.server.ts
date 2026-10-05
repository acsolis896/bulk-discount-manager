import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

// A discount's settings live in a separate metafield that the Function reads. If that
// write is lost, the discount exists but never applies ("valid but not applicable"),
// and nothing tells the merchant. This saves the metafield and then reads it back.

const SET_CONFIG = `#graphql
  mutation SetFunctionConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }`;

const READ_CONFIG = `#graphql
  query ReadFunctionConfig($id: ID!) {
    discountNode(id: $id) {
      metafield(namespace: "$app", key: "function-configuration") { value }
    }
  }`;

// Shopify gives a Function `null` for any metafield value over 10,000 bytes. The value is
// still stored (and visible in the app), but the discount silently never applies. The
// product list is what grows, at about 40 bytes per product, so large collections hit it.
export const FUNCTION_CONFIG_LIMIT_BYTES = 10_000;
const DEFAULT_OTHER_SETTINGS_BYTES = 1_000; // value, countries, blocked types, tags...

export function configByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** True when a stored config is too big for Shopify to hand to the Function. */
export function configTooLargeForFunction(value: string): boolean {
  return configByteLength(value) > FUNCTION_CONFIG_LIMIT_BYTES;
}

/**
 * Returns a merchant-facing message if this many individually selected product IDs won't fit in the
 * config the Function reads, otherwise null. Collections are matched live and are not counted. Pass the real size of the other settings when known.
 */
export function configSizeProblem(productIds: string[], otherSettingsBytes = DEFAULT_OTHER_SETTINGS_BYTES): string | null {
  const listBytes = configByteLength(JSON.stringify(productIds));
  if (listBytes + otherSettingsBytes <= FUNCTION_CONFIG_LIMIT_BYTES) return null;
  const perProduct = Math.ceil(listBytes / Math.max(productIds.length, 1));
  const max = Math.max(0, Math.floor((FUNCTION_CONFIG_LIMIT_BYTES - otherSettingsBytes) / perProduct));
  return (
    `You selected ${productIds.length} products one by one, but Shopify only lets a discount keep about ${max} ` +
    `of those, so its codes would never apply at checkout. Choose a collection instead (collections can be any ` +
    `size), or split the products across several sets.`
  );
}

export type SaveConfigResult = { ok: true } | { ok: false; message: string };

/** discountCodeAppCreate returns a DiscountCodeApp GID; reads need the DiscountCodeNode GID. */
export function discountNodeId(id: string): string {
  return id.replace("DiscountCodeApp", "DiscountCodeNode");
}

/**
 * Saves the config and confirms it landed. A userError from Shopify fails immediately
 * (same as before). An unusable response, or a read-back that finds no value, is retried
 * once and then reported. If the read-back itself can't run, the save is accepted, so
 * this never blocks a discount that the old code would have created.
 */
export async function saveFunctionConfig(
  admin: AdminApiContext,
  { ownerId, readId, value }: { ownerId: string; readId: string; value: string }
): Promise<SaveConfigResult> {
  let lastProblem = "Shopify did not confirm the save";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await admin.graphql(SET_CONFIG, {
        variables: {
          metafields: [{ ownerId, namespace: "$app", key: "function-configuration", type: "json", value }],
        },
      });
      const data = (await res.json()) as {
        data?: { metafieldsSet?: { userErrors?: { message: string }[] } | null };
        errors?: { message?: string }[];
      };
      const result = data.data?.metafieldsSet;
      const userErrors = result?.userErrors ?? [];
      if (userErrors.length > 0) {
        return { ok: false, message: userErrors.map((e) => e.message).join(", ") };
      }
      if (!result) {
        lastProblem = data.errors?.[0]?.message ?? lastProblem;
        continue;
      }
    } catch (err) {
      lastProblem = err instanceof Error ? err.message : lastProblem;
      continue;
    }

    try {
      const readRes = await admin.graphql(READ_CONFIG, { variables: { id: readId } });
      const readData = await readRes.json();
      const node = readData.data?.discountNode;
      if (!node) return { ok: true }; // can't verify; don't block
      if (node.metafield?.value) return { ok: true };
      lastProblem = "the settings were not found after saving";
    } catch {
      return { ok: true }; // can't verify; don't block
    }
  }

  return { ok: false, message: lastProblem };
}
