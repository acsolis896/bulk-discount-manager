import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const numericId = params.id!;
  const discountId = `gid://shopify/DiscountCodeNode/${numericId}`;

  const row = await db.singleCodeDiscount.findFirst({
    where: { shop: session.shop, discountId },
  });
  if (!row) throw new Response("Not found", { status: 404 });

  // Fetch discount details from Shopify
  const res = await admin.graphql(
    `#graphql
    query GetSingleCode($id: ID!) {
      discountNode(id: $id) {
        id
        discount {
          ... on DiscountCodeApp {
            title
            status
            asyncUsageCount
            startsAt
            endsAt
            combinesWith { productDiscounts orderDiscounts shippingDiscounts }
            codes(first: 1) { nodes { code } }
          }
        }
        metafield(namespace: "$app", key: "function-configuration") { value }
      }
    }`,
    { variables: { id: discountId } }
  );
  const data = await res.json();
  const node = data.data?.discountNode;
  const discount = node?.discount;

  // Read the metafield from the real function node if different from construction node
  const functionNodeId = row.functionNodeId;
  let metafieldValue = node?.metafield?.value;
  if (functionNodeId && functionNodeId !== discountId) {
    const fnRes = await admin.graphql(
      `#graphql
      query GetFunctionNodeMF($id: ID!) {
        discountNode(id: $id) {
          metafield(namespace: "$app", key: "function-configuration") { value }
        }
      }`,
      { variables: { id: functionNodeId } }
    );
    const fnData = await fnRes.json();
    const fnValue = fnData.data?.discountNode?.metafield?.value;
    if (fnValue) metafieldValue = fnValue;
  }

  let config: Record<string, unknown> = {};
  try { config = JSON.parse(metafieldValue); } catch {}

  // Resolve collection titles
  const collectionIds: string[] = (config.collectionIds as string[]) ?? [];
  const productIds: string[] = (config.productIds as string[]) ?? [];
  let collectionTitles: string[] = [];
  if (collectionIds.length > 0) {
    const colRes = await admin.graphql(
      `#graphql
      query GetCollectionTitles($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Collection { id title }
        }
      }`,
      { variables: { ids: collectionIds } }
    );
    const colData = await colRes.json();
    collectionTitles = (colData.data?.nodes ?? []).map((n: { title?: string }) => n?.title ?? "").filter(Boolean);
  }

  return {
    dbId: row.id,
    discountId,
    numericId,
    code: row.code,
    requiredTag: row.requiredTag,
    blockedTag: row.blockedTag,
    title: discount?.title ?? row.code,
    status: discount?.status ?? "UNKNOWN",
    usageCount: discount?.asyncUsageCount ?? 0,
    startsAt: discount?.startsAt ?? null,
    endsAt: discount?.endsAt ?? null,
    combinesWith: discount?.combinesWith ?? { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
    discountType: config.discountType === "fixedAmount" ? "fixedAmount" : "percentage",
    percentage: config.percentage ?? null,
    fixedAmount: config.fixedAmount ?? null,
    oncePerOrder: config.oncePerOrder !== false,
    productIds,
    collectionIds,
    collectionTitles,
    blockedProductTypes: (config.blockedProductTypes as string[]) ?? [],
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const numericId = params.id!;
  const discountId = `gid://shopify/DiscountCodeNode/${numericId}`;
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "updateConfig") {
    const requiredTag = String(formData.get("requiredTag") || "").trim();
    const blockedTag = String(formData.get("blockedTag") || "").trim();
    const discountType = String(formData.get("discountType") || "percentage") === "fixedAmount" ? "fixedAmount" : "percentage";
    const percentage = Number(formData.get("percentage") || 0);
    const fixedAmount = Number(formData.get("fixedAmount") || 0);
    const oncePerOrder = formData.get("oncePerOrder") !== "0";
    const productIds: string[] = JSON.parse(String(formData.get("productIds") || "[]"));
    const collectionIds: string[] = JSON.parse(String(formData.get("collectionIds") || "[]"));

    if (discountType === "percentage") {
      if (!percentage || percentage < 1 || percentage > 100) return { error: "Percentage must be between 1 and 100." };
    } else {
      if (!fixedAmount || fixedAmount <= 0) return { error: "Fixed amount must be greater than 0." };
    }
    if (productIds.length === 0 && collectionIds.length === 0) return { error: "Select at least one eligible product or collection." };

    // Expand collections
    let resolvedProductIds = [...productIds];
    if (collectionIds.length > 0) {
      for (const collectionId of collectionIds) {
        let cursor: string | null = null;
        do {
          const colRes = await admin.graphql(
            `#graphql
            query CollectionProducts($id: ID!, $after: String) {
              collection(id: $id) {
                products(first: 250, after: $after) {
                  nodes { id }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }`,
            { variables: { id: collectionId, after: cursor } }
          );
          const colData = await colRes.json();
          const products = colData.data?.collection?.products;
          for (const p of products?.nodes ?? []) {
            if (!resolvedProductIds.includes(p.id)) resolvedProductIds.push(p.id);
          }
          cursor = products?.pageInfo?.hasNextPage ? products.pageInfo.endCursor : null;
        } while (cursor);
      }
    }

    // Look up functionNodeId from DB
    const dbRow = await db.singleCodeDiscount.findFirst({ where: { shop: session.shop, discountId }, select: { functionNodeId: true } });
    const fnNodeId = dbRow?.functionNodeId ?? null;
    const readFromId = fnNodeId ?? discountId;

    // Fetch existing metafield to preserve eligibility lists and blockedProductTypes
    const mfRes = await admin.graphql(
      `#graphql
      query GetMF($id: ID!) {
        discountNode(id: $id) {
          metafield(namespace: "$app", key: "function-configuration") { value }
        }
      }`,
      { variables: { id: readFromId } }
    );
    const mfData = await mfRes.json();
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(mfData.data?.discountNode?.metafield?.value); } catch {}

    const newConfig = {
      ...existing,
      productIds: resolvedProductIds,
      collectionIds,
      discountType,
      percentage: discountType === "percentage" ? percentage : undefined,
      fixedAmount: discountType === "fixedAmount" ? fixedAmount : undefined,
      oncePerOrder,
      requiredTag,
      blockedTag,
    };

    // Write to both construction node and real function node (if different)
    const writeTargets = [discountId];
    if (fnNodeId && fnNodeId !== discountId) writeTargets.push(fnNodeId);
    for (const ownerId of writeTargets) {
      const saveRes = await admin.graphql(
        `#graphql
        mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
        {
          variables: {
            metafields: [
              { ownerId, namespace: "$app", key: "function-configuration", type: "json", value: JSON.stringify(newConfig) },
            ],
          },
        }
      );
      const saveData = await saveRes.json();
      const saveErrors = saveData.data?.metafieldsSet?.userErrors ?? [];
      if (saveErrors.length > 0) {
        return { error: `Failed to save: ${saveErrors.map((e: { message: string }) => e.message).join(", ")}` };
      }
    }

    const baseConfigJson = JSON.stringify({
      productIds: resolvedProductIds,
      collectionIds,
      discountType,
      percentage: discountType === "percentage" ? percentage : undefined,
      fixedAmount: discountType === "fixedAmount" ? fixedAmount : undefined,
      oncePerOrder,
      blockedProductTypes: existing.blockedProductTypes ?? ["GWP"],
      requiredTag,
      blockedTag,
    });

    await db.singleCodeDiscount.updateMany({
      where: { shop: session.shop, discountId },
      data: { requiredTag, blockedTag, configJson: baseConfigJson },
    });

    return { success: true };
  }

  if (intent === "delete") {
    // Try to delete from Shopify (may already be gone)
    try {
      await admin.graphql(
        `#graphql
        mutation DeleteDiscount($id: ID!) {
          discountCodeDelete(id: $id) {
            userErrors { field message }
          }
        }`,
        { variables: { id: discountId } }
      );
    } catch { /* ignore — already deleted from Shopify */ }

    await db.singleCodeDiscount.deleteMany({ where: { shop: session.shop, discountId } });
    return { deleted: true };
  }

  return { error: "Unknown intent" };
};

export default function SingleCodeDetailsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  const [editing, setEditing] = useState(false);
  const [requiredTag, setRequiredTag] = useState(loaderData.requiredTag);
  const [blockedTag, setBlockedTag] = useState(loaderData.blockedTag);
  const [discountType, setDiscountType] = useState<"percentage" | "fixedAmount">(loaderData.discountType);
  const [percentage, setPercentage] = useState(String(loaderData.percentage ?? ""));
  const [fixedAmount, setFixedAmount] = useState(String(loaderData.fixedAmount ?? ""));
  const [oncePerOrder, setOncePerOrder] = useState(loaderData.oncePerOrder);
  const [productIds, setProductIds] = useState<string[]>(loaderData.productIds);
  const [productTitles, setProductTitles] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>(loaderData.collectionIds);
  const [collectionTitles, setCollectionTitles] = useState<string[]>(loaderData.collectionTitles);

  const isSaving = fetcher.state !== "idle";
  const result = fetcher.data as { error?: string; success?: boolean; deleted?: boolean } | undefined;

  useEffect(() => {
    if (result?.success && editing) setEditing(false);
    if (result?.deleted) navigate("/app/single-codes");
  }, [result]);

  const handlePickCollections = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: collectionIds.map((id) => ({ id })),
    });
    if (selected) {
      setCollectionIds(selected.map((c: { id: string }) => c.id));
      setCollectionTitles(selected.map((c: { title: string }) => c.title));
      setProductIds([]);
      setProductTitles([]);
    }
  }, [shopify, collectionIds]);

  const handlePickProducts = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: productIds.map((id) => ({ id })),
    });
    if (selected) {
      setProductIds(selected.map((p: { id: string }) => p.id));
      setProductTitles(selected.map((p: { title: string }) => p.title));
      setCollectionIds([]);
      setCollectionTitles([]);
    }
  }, [shopify, productIds]);

  const handleSave = () => {
    const form = new FormData();
    form.set("intent", "updateConfig");
    form.set("requiredTag", requiredTag);
    form.set("blockedTag", blockedTag);
    form.set("discountType", discountType);
    form.set("percentage", percentage);
    form.set("fixedAmount", fixedAmount);
    form.set("oncePerOrder", oncePerOrder ? "1" : "0");
    form.set("productIds", JSON.stringify(productIds));
    form.set("collectionIds", JSON.stringify(collectionIds));
    fetcher.submit(form, { method: "post" });
  };

  const status = loaderData.status;
  const displayedCollections = collectionTitles.length > 0 ? collectionTitles : loaderData.collectionTitles;
  const hasCollections = collectionIds.length > 0;

  return (
    <s-page heading={loaderData.title}>
      <div style={{ marginBottom: "16px" }}>
        <s-button onClick={() => navigate("/app/single-codes")}>← Back to Reusable codes</s-button>
      </div>

      {result?.error && (
        <s-banner tone="critical" style={{ marginBottom: "16px" }}>
          <s-paragraph>{result.error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Overview">
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", gap: "24px" }}>
            <div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Code</div>
              <span style={{ fontFamily: "monospace", fontSize: "18px", fontWeight: 600 }}>{loaderData.code}</span>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Status</div>
              {status === "ACTIVE" ? (
                <s-badge tone="success">Active</s-badge>
              ) : status === "EXPIRED" ? (
                <s-badge tone="critical">Expired</s-badge>
              ) : (
                <s-badge>{status.charAt(0) + status.slice(1).toLowerCase()}</s-badge>
              )}
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Times used</div>
              <span style={{ fontSize: "16px", fontWeight: 500 }}>{loaderData.usageCount}</span>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Discount</div>
              <span style={{ fontSize: "16px", fontWeight: 500 }}>
                {loaderData.discountType === "fixedAmount" ? `$${loaderData.fixedAmount}` : `${loaderData.percentage}%`}
              </span>
            </div>
          </div>
          {loaderData.endsAt && (
            <div style={{ fontSize: "13px", color: "#6d7175" }}>
              Expires: {new Date(loaderData.endsAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </s-section>

      <s-section heading="Eligible items">
        {!editing ? (
          <>
            {hasCollections ? (
              <s-paragraph>{displayedCollections.join(", ")}</s-paragraph>
            ) : productIds.length > 0 ? (
              <s-paragraph>{productIds.length} product{productIds.length > 1 ? "s" : ""}</s-paragraph>
            ) : (
              <s-paragraph>No items configured.</s-paragraph>
            )}
          </>
        ) : (
          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <s-button onClick={handlePickCollections}>Browse collections</s-button>
            <s-button onClick={handlePickProducts}>Browse products</s-button>
          </div>
        )}
        {editing && (
          <s-paragraph>
            {collectionIds.length > 0
              ? `${collectionIds.length} collection${collectionIds.length > 1 ? "s" : ""}: ${collectionTitles.join(", ")}`
              : productIds.length > 0
                ? `${productIds.length} product${productIds.length > 1 ? "s" : ""}: ${productTitles.join(", ")}`
                : "None selected"}
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Customer eligibility">
        {!editing ? (
          <div style={{ display: "flex", gap: "24px" }}>
            <div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Required tag</div>
              <span style={{ fontFamily: "monospace" }}>{loaderData.requiredTag || "—"}</span>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Blocked tag</div>
              <span style={{ fontFamily: "monospace" }}>{loaderData.blockedTag || "—"}</span>
            </div>
          </div>
        ) : (
          <>
            <s-text-field
              label="Required customer tag"
              value={requiredTag}
              placeholder="e.g. GUIDE50"
              helpText="Customers must have this tag to use the code"
              onInput={(e: { target: { value: string } }) => setRequiredTag(e.target.value)}
            />
            <s-text-field
              label="Blocked customer tag"
              value={blockedTag}
              placeholder="e.g. GUIDE50-USED"
              helpText="Customers with this tag will be rejected (usage limit reached)"
              onInput={(e: { target: { value: string } }) => setBlockedTag(e.target.value)}
            />
            <div style={{ width: "fit-content" }}>
              <div style={{ display: "inline-flex", background: "#f1f1f1", borderRadius: "8px", padding: "3px", gap: "2px" }}>
                {(["percentage", "fixedAmount"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setDiscountType(type)}
                    style={{
                      padding: "6px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
                      fontSize: "14px", fontWeight: 500, transition: "all 0.15s",
                      background: discountType === type ? "#fff" : "transparent",
                      color: discountType === type ? "#202223" : "#6d7175",
                      boxShadow: discountType === type ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                    }}
                  >
                    {type === "percentage" ? "Percentage" : "Fixed amount"}
                  </button>
                ))}
              </div>
            </div>
            {discountType === "percentage" ? (
              <s-text-field
                label="Discount percentage"
                type="number"
                value={percentage}
                min="1"
                max="100"
                helpText="Percentage off the eligible product"
                onInput={(e: { target: { value: string } }) => setPercentage(e.target.value)}
              />
            ) : (
              <s-text-field
                label="Amount off"
                type="number"
                value={fixedAmount}
                min="0.01"
                step="0.01"
                prefix="$"
                helpText="Fixed amount off the eligible product"
                onInput={(e: { target: { value: string } }) => setFixedAmount(e.target.value)}
              />
            )}
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
              <input type="checkbox" checked={oncePerOrder} onChange={(e) => setOncePerOrder(e.target.checked)} />
              Only apply discount once per order
            </label>
          </>
        )}
      </s-section>

      <div style={{ display: "flex", gap: "8px", marginTop: "16px", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          {!editing ? (
            <s-button variant="primary" onClick={() => setEditing(true)}>Edit</s-button>
          ) : (
            <>
              <s-button variant="primary" disabled={isSaving} onClick={handleSave}>
                {isSaving ? "Saving..." : "Save changes"}
              </s-button>
              <s-button onClick={() => setEditing(false)}>Cancel</s-button>
            </>
          )}
        </div>
        <s-button
          tone="critical"
          disabled={isSaving}
          onClick={() => {
            if (confirm(`Delete ${loaderData.code}? This cannot be undone.`)) {
              const form = new FormData();
              form.set("intent", "delete");
              fetcher.submit(form, { method: "post" });
            }
          }}
        >
          Delete
        </s-button>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
