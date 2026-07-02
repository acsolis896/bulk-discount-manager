import { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const rows = await db.blockedProductType.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "asc" },
      select: { id: true, productType: true },
    });
    return { blockedTypes: rows, dbError: null };
  } catch (err: unknown) {
    return { blockedTypes: [], dbError: err instanceof Error ? err.message : String(err) };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const productType = (formData.get("productType") as string ?? "").trim().toUpperCase();
    if (!productType) return { error: "Product type is required." };
    await db.blockedProductType.upsert({
      where: { shop_productType: { shop: session.shop, productType } },
      create: { shop: session.shop, productType },
      update: {},
    });
    return { ok: true };
  }

  if (intent === "remove") {
    const id = formData.get("id") as string;
    await db.blockedProductType.deleteMany({ where: { id, shop: session.shop } });
    return { ok: true };
  }

  if (intent === "sync") {
    // Fetch current blocked types for this shop
    const rows = await db.blockedProductType.findMany({
      where: { shop: session.shop },
      select: { productType: true },
    });
    const blockedProductTypes = rows.length > 0 ? rows.map((r: { productType: string }) => r.productType) : ["GWP"];

    // Fetch all discount nodes first, then batch-update metafields
    let cursor: string | null = null;
    let updated = 0;
    const errors: string[] = [];
    const allNodes: Array<{ id: string; title: string; metafieldValue: string | null }> = [];

    try {
      do {
        const res = await admin.graphql(
          `#graphql
          query GetAllDiscounts($after: String) {
            discountNodes(first: 50, after: $after, query: "function_id:discount-rejection-function-js") {
              nodes {
                id
                discount {
                  ... on DiscountCodeApp { title }
                }
                metafield(namespace: "$app", key: "function-configuration") {
                  value
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          { variables: { after: cursor } }
        );
        const data = await res.json();
        const nodes = data.data?.discountNodes?.nodes ?? [];
        for (const node of nodes) {
          allNodes.push({
            id: node.id,
            title: node.discount?.title ?? node.id,
            metafieldValue: node.metafield?.value ?? null,
          });
        }
        const pageInfo = data.data?.discountNodes?.pageInfo;
        cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
      } while (cursor);

      // Batch all metafield updates in one mutation (up to 25 at a time)
      const metafields = allNodes.map((node) => {
        let config: Record<string, unknown> = {};
        try { if (node.metafieldValue) config = JSON.parse(node.metafieldValue); } catch { /* empty */ }
        return {
          ownerId: node.id,
          namespace: "$app",
          key: "function-configuration",
          type: "json",
          value: JSON.stringify({ ...config, blockedProductTypes }),
        };
      });

      for (let i = 0; i < metafields.length; i += 25) {
        const batch = metafields.slice(i, i + 25);
        const updateRes = await admin.graphql(
          `#graphql
          mutation SyncMetafields($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
            }
          }`,
          { variables: { metafields: batch } }
        );
        const updateData = await updateRes.json();
        const updateErrors = updateData.data?.metafieldsSet?.userErrors ?? [];
        if (updateErrors.length > 0) {
          errors.push(...updateErrors.map((e: { message: string }) => e.message));
        } else {
          updated += batch.length;
        }
      }
    } catch (err: unknown) {
      return { error: `Sync failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (errors.length > 0) return { error: `Synced ${updated} discounts, but ${errors.length} failed: ${errors.join("; ")}` };
    return { synced: updated };
  }

  return { error: "Unknown action." };
};

export default function SettingsPage() {
  const { blockedTypes, dbError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [newType, setNewType] = useState("");

  const isFetcherBusy = fetcher.state !== "idle";
  const [forcedIdle, setForcedIdle] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isFetcherBusy && fetcher.formData?.get("intent") === "sync") {
      setForcedIdle(false);
      syncTimeoutRef.current = setTimeout(() => setForcedIdle(true), 60000);
    } else {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      setForcedIdle(false);
    }
    return () => { if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current); };
  }, [isFetcherBusy, fetcher.formData]);

  const isSubmitting = isFetcherBusy && !forcedIdle;
  const result = fetcher.data;

  const handleAdd = () => {
    if (!newType.trim()) return;
    const form = new FormData();
    form.append("intent", "add");
    form.append("productType", newType.trim());
    fetcher.submit(form, { method: "post" });
    setNewType("");
  };

  const handleRemove = (id: string) => {
    const form = new FormData();
    form.append("intent", "remove");
    form.append("id", id);
    fetcher.submit(form, { method: "post" });
  };

  const handleSync = () => {
    const form = new FormData();
    form.append("intent", "sync");
    fetcher.submit(form, { method: "post" });
  };

  return (
    <s-page heading="Discount Rules">
      <s-section heading="Blocked product types">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Discount codes will not apply when any item in the cart has one of the following product types.
            Product types are set on products in the Shopify admin under the product details.
          </s-paragraph>

          {dbError && (
            <s-banner tone="critical">
              <s-paragraph>Database error: {dbError}</s-paragraph>
            </s-banner>
          )}
          {(result as { error?: string })?.error && (
            <s-banner tone="critical">
              <s-paragraph>{(result as { error: string }).error}</s-paragraph>
            </s-banner>
          )}
          {(result as { synced?: number })?.synced !== undefined && (
            <s-banner tone="success">
              <s-paragraph>Synced: updated {(result as { synced: number }).synced} discount set{(result as { synced: number }).synced !== 1 ? "s" : ""} with the current blocked types.</s-paragraph>
            </s-banner>
          )}

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px", gap: "12px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 1 }}>Product type</span>
            <span style={{ width: "80px" }}></span>
          </div>

          {blockedTypes.length === 0 && (
            <div style={{ padding: "12px", color: "#6d7175", fontSize: "14px" }}>
              No blocked product types configured. Discounts will apply to all product types.
            </div>
          )}

          {blockedTypes.map((t: { id: string; productType: string }) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", padding: "12px", borderBottom: "1px solid #e1e3e5", gap: "12px" }}>
              <span style={{ fontFamily: "monospace", fontSize: "14px", fontWeight: 500, flex: 1 }}>{t.productType}</span>
              <div style={{ width: "80px", display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => handleRemove(t.id)}
                  disabled={isSubmitting}
                  style={{ padding: "4px 10px", fontSize: "12px", background: "transparent", border: "1px solid #f5c6c2", borderRadius: "5px", cursor: "pointer", color: "#d72c0d" }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {/* Add new */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
            <input
              type="text"
              placeholder="e.g. GWP"
              value={newType}
              onChange={(e) => setNewType(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              style={{ padding: "8px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #ccc", flex: 1 }}
            />
            <s-button variant="primary" onClick={handleAdd} disabled={isSubmitting || !newType.trim()}>
              Add
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Sync to existing discounts">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            After changing blocked product types, click Sync to update all existing discount sets.
            This applies the current blocked types list to every discount created with this app.
          </s-paragraph>
          <div>
            <s-button variant="primary" onClick={handleSync} disabled={isSubmitting}>
              {isSubmitting && (fetcher.formData?.get("intent") === "sync") ? "Syncing…" : "Sync to all discounts"}
            </s-button>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
