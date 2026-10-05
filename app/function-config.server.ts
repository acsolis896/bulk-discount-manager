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
