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
    const rows = await db.blockedProductType.findMany({
      where: { shop: session.shop },
      select: { productType: true },
    });
    const blockedProductTypes = rows.length > 0 ? rows.map((r: { productType: string }) => r.productType) : ["GWP"];

    const dbCodes = await db.singleCodeDiscount.findMany({
      where: { shop: session.shop },
      select: { discountId: true, code: true, configJson: true, eligibleCustomerIds: true, blockedCustomerIds: true, functionNodeId: true },
    });
    const codeMap = new Map(dbCodes.map((c: { code: string; discountId: string; configJson: string | null; eligibleCustomerIds: string | null; blockedCustomerIds: string | null; functionNodeId: string | null }) => [c.code.toUpperCase(), c]));

    let cursor: string | null = null;
    let updated = 0;
    const errors: string[] = [];
    const metafields: Array<{ ownerId: string; namespace: string; key: string; type: string; value: string }> = [];

    try {
      do {
        const res = await admin.graphql(
          `#graphql
          query GetAllDiscounts($after: String) {
            discountNodes(first: 50, after: $after, query: "function_id:discount-rejection-function-js") {
              nodes {
                id
                discount {
                  ... on DiscountCodeApp {
                    codes(first: 1) { nodes { code } }
                  }
                }
                metafield(namespace: "$app", key: "function-configuration") { value }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          { variables: { after: cursor } }
        );
        const data = await res.json();
        const nodes = data.data?.discountNodes?.nodes ?? [];

        for (const node of nodes) {
          // Skip non-code-discount nodes (e.g. DiscountAutomaticNode) — they cause silent metafieldsSet batch failures
          if (!node.id.includes("DiscountCodeNode")) continue;
          const discountCode = node.discount?.codes?.nodes?.[0]?.code?.toUpperCase() ?? null;
          const dbRecord = discountCode ? codeMap.get(discountCode) : null;

          if (dbRecord) {
            let baseConfig: Record<string, unknown> = {};

            if (dbRecord.configJson) {
              try { baseConfig = JSON.parse(dbRecord.configJson); } catch { /* empty */ }
            } else {
              const fallbackRes = await admin.graphql(
                `#graphql
                query GetMF($id: ID!) {
                  discountNode(id: $id) {
                    metafield(namespace: "$app", key: "function-configuration") { value }
                  }
                }`,
                { variables: { id: dbRecord.discountId } }
              );
              const fallbackData = await fallbackRes.json();
              const fallbackValue = fallbackData.data?.discountNode?.metafield?.value;
              try { if (fallbackValue) baseConfig = JSON.parse(fallbackValue); } catch { /* empty */ }
              if (Object.keys(baseConfig).length > 0) {
                await db.singleCodeDiscount.updateMany({
                  where: { shop: session.shop, discountId: dbRecord.discountId },
                  data: { configJson: JSON.stringify(baseConfig) },
                });
              }
            }

            const eligibleCustomerIds = dbRecord.eligibleCustomerIds ? JSON.parse(dbRecord.eligibleCustomerIds) : undefined;
            const blockedCustomerIds = dbRecord.blockedCustomerIds ? JSON.parse(dbRecord.blockedCustomerIds) : undefined;
            const fullConfig: Record<string, unknown> = { ...baseConfig, blockedProductTypes };
            if (eligibleCustomerIds !== undefined) fullConfig.eligibleCustomerIds = eligibleCustomerIds;
            if (blockedCustomerIds !== undefined) fullConfig.blockedCustomerIds = blockedCustomerIds;

            if (node.id !== dbRecord.functionNodeId) {
              await db.singleCodeDiscount.updateMany({
                where: { shop: session.shop, discountId: dbRecord.discountId },
                data: { functionNodeId: node.id },
              });
            }

            metafields.push({ ownerId: node.id, namespace: "$app", key: "function-configuration", type: "json", value: JSON.stringify(fullConfig) });
          } else {
            let config: Record<string, unknown> = {};
            try { if (node.metafield?.value) config = JSON.parse(node.metafield.value); } catch { /* empty */ }
            metafields.push({ ownerId: node.id, namespace: "$app", key: "function-configuration", type: "json", value: JSON.stringify({ ...config, blockedProductTypes }) });
          }
        }

        const pageInfo = data.data?.discountNodes?.pageInfo;
        cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
      } while (cursor);

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

  if (intent === "syncCustomers") {
    const codes = await db.singleCodeDiscount.findMany({
      where: { shop: session.shop },
      select: { discountId: true, code: true, requiredTag: true, blockedTag: true, configJson: true, functionNodeId: true },
    });

    if (codes.length === 0) return { syncedCustomers: 0 };

    // For any discount missing functionNodeId, scan discountNodes to find the real function node now
    const needsLookup = codes.filter((c: { functionNodeId: string | null }) => !c.functionNodeId);
    if (needsLookup.length > 0) {
      const needsMap = new Map(needsLookup.map((c: { code: string; discountId: string; functionNodeId: string | null }) => [c.code.toUpperCase(), c]));
      let scanCursor: string | null = null;
      do {
        const scanRes = await admin.graphql(
          `#graphql
          query FindFunctionNodes($after: String) {
            discountNodes(first: 50, after: $after, query: "function_id:discount-rejection-function-js") {
              nodes {
                id
                discount {
                  ... on DiscountCodeApp {
                    codes(first: 1) { nodes { code } }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          { variables: { after: scanCursor } }
        );
        const scanData = await scanRes.json();
        for (const n of scanData.data?.discountNodes?.nodes ?? []) {
          if (!n.id.includes("DiscountCodeNode")) continue;
          const nodeCode = n.discount?.codes?.nodes?.[0]?.code?.toUpperCase();
          if (nodeCode && needsMap.has(nodeCode)) {
            const rec = needsMap.get(nodeCode)!;
            rec.functionNodeId = n.id;
            await db.singleCodeDiscount.updateMany({
              where: { shop: session.shop, discountId: rec.discountId },
              data: { functionNodeId: n.id },
            });
            needsMap.delete(nodeCode);
          }
        }
        const pi = scanData.data?.discountNodes?.pageInfo;
        scanCursor = (pi?.hasNextPage && needsMap.size > 0) ? pi.endCursor : null;
      } while (scanCursor);
    }

    const errors: string[] = [];
    let syncedCount = 0;

    for (const code of codes) {
      if (!code.configJson) {
        errors.push(`Discount ${code.discountId} has no saved config — re-create it to enable customer sync.`);
        continue;
      }

      let baseConfig: Record<string, unknown>;
      try { baseConfig = JSON.parse(code.configJson); } catch { errors.push(`Bad configJson for ${code.discountId}`); continue; }

      const eligibleCustomerIds: string[] = [];
      const blockedCustomerIds: string[] = [];

      if (code.requiredTag) {
        let cursor: string | null = null;
        do {
          const res = await admin.graphql(
            `#graphql
            query CustomersWithTag($query: String!, $after: String) {
              customers(first: 250, query: $query, after: $after) {
                nodes { id }
                pageInfo { hasNextPage endCursor }
              }
            }`,
            { variables: { query: `tag:'${code.requiredTag}'`, after: cursor } }
          );
          const data = await res.json();
          const customers = data.data?.customers;
          for (const c of customers?.nodes ?? []) eligibleCustomerIds.push(c.id);
          cursor = customers?.pageInfo?.hasNextPage ? customers.pageInfo.endCursor : null;
        } while (cursor);
      }

      if (code.blockedTag) {
        let cursor: string | null = null;
        do {
          const res = await admin.graphql(
            `#graphql
            query CustomersWithTag($query: String!, $after: String) {
              customers(first: 250, query: $query, after: $after) {
                nodes { id }
                pageInfo { hasNextPage endCursor }
              }
            }`,
            { variables: { query: `tag:'${code.blockedTag}'`, after: cursor } }
          );
          const data = await res.json();
          const customers = data.data?.customers;
          for (const c of customers?.nodes ?? []) blockedCustomerIds.push(c.id);
          cursor = customers?.pageInfo?.hasNextPage ? customers.pageInfo.endCursor : null;
        } while (cursor);
      }

      const fullConfig = JSON.stringify({ ...baseConfig, eligibleCustomerIds, blockedCustomerIds });

      await db.singleCodeDiscount.update({
        where: { shop_discountId: { shop: session.shop, discountId: code.discountId } },
        data: {
          eligibleCustomerIds: JSON.stringify(eligibleCustomerIds),
          blockedCustomerIds: JSON.stringify(blockedCustomerIds),
        },
      });

      // Write to the real function node (discovered above if it was missing)
      const writeTarget = code.functionNodeId ?? code.discountId;
      const mfRes = await admin.graphql(
        `#graphql
        mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
        { variables: { metafields: [{ ownerId: writeTarget, namespace: "$app", key: "function-configuration", type: "json", value: fullConfig }] } }
      );
      const mfData = await mfRes.json();
      const mfErrors = mfData.data?.metafieldsSet?.userErrors ?? [];
      if (mfErrors.length > 0) {
        errors.push(`Discount ${code.discountId}: ${mfErrors.map((e: { message: string }) => e.message).join(", ")}`);
      } else {
        syncedCount++;
      }
    }

    if (errors.length > 0) return { error: `Synced ${syncedCount} discounts. Errors: ${errors.join("; ")}` };
    return { syncedCustomers: syncedCount };
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
    const intent = fetcher.formData?.get("intent");
    if (isFetcherBusy && intent === "sync") {
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

  const handleSyncCustomers = () => {
    const form = new FormData();
    form.append("intent", "syncCustomers");
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
          {(result as { syncedCustomers?: number })?.syncedCustomers !== undefined && (
            <s-banner tone="success">
              <s-paragraph>Customer eligibility synced for {(result as { syncedCustomers: number }).syncedCustomers} discount{(result as { syncedCustomers: number }).syncedCustomers !== 1 ? "s" : ""}.</s-paragraph>
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

      <s-section heading="Sync customer eligibility">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            For each single-code discount, fetches all customers with the required tag (eligible) and blocked tag (usage limit reached) from Shopify and updates the discount's customer lists. Run this after tagging or un-tagging customers.
          </s-paragraph>
          <div>
            <s-button variant="primary" onClick={handleSyncCustomers} disabled={isSubmitting}>
              {isSubmitting && (fetcher.formData?.get("intent") === "syncCustomers") ? "Syncing customers…" : "Sync customer eligibility"}
            </s-button>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
