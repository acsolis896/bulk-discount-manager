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
  const metafieldValue = node?.metafield?.value;
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
    percentage: config.percentage ?? null,
    productIds,
    collectionIds,
    collectionTitles,
    blockedProductTypes: (config.blockedProductTypes as string[]) ?? [],
    metafieldRaw: metafieldValue ?? null,
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
    const percentage = Number(formData.get("percentage") || 0);
    const productIds: string[] = JSON.parse(String(formData.get("productIds") || "[]"));
    const collectionIds: string[] = JSON.parse(String(formData.get("collectionIds") || "[]"));

    if (!percentage || percentage < 1 || percentage > 100) return { error: "Percentage must be between 1 and 100." };
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

    // Fetch existing metafield to preserve blockedProductTypes
    const mfRes = await admin.graphql(
      `#graphql
      query GetMF($id: ID!) {
        discountNode(id: $id) {
          metafield(namespace: "$app", key: "function-configuration") { value }
        }
      }`,
      { variables: { id: discountId } }
    );
    const mfData = await mfRes.json();
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(mfData.data?.discountNode?.metafield?.value); } catch {}

    const newConfig = {
      ...existing,
      productIds: resolvedProductIds,
      collectionIds,
      percentage,
      requiredTag,
      blockedTag,
    };

    await admin.graphql(
      `#graphql
      mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [{
            ownerId: discountId,
            namespace: "$app",
            key: "function-configuration",
            type: "json",
            value: JSON.stringify(newConfig),
          }],
        },
      }
    );

    await db.singleCodeDiscount.updateMany({
      where: { shop: session.shop, discountId },
      data: { requiredTag, blockedTag },
    });

    return { success: true };
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
  const [percentage, setPercentage] = useState(String(loaderData.percentage ?? ""));
  const [productIds, setProductIds] = useState<string[]>(loaderData.productIds);
  const [productTitles, setProductTitles] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>(loaderData.collectionIds);
  const [collectionTitles, setCollectionTitles] = useState<string[]>(loaderData.collectionTitles);

  const isSaving = fetcher.state !== "idle";
  const result = fetcher.data as { error?: string; success?: boolean } | undefined;

  useEffect(() => {
    if (result?.success && editing) setEditing(false);
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
    form.set("percentage", percentage);
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
        <s-button onClick={() => navigate("/app/single-codes")}>← Back to Single codes</s-button>
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
              <span style={{ fontSize: "16px", fontWeight: 500 }}>{loaderData.percentage}%</span>
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
            <s-text-field
              label="Discount percentage"
              type="number"
              value={percentage}
              min="1"
              max="100"
              helpText="Percentage off the eligible product"
              onInput={(e: { target: { value: string } }) => setPercentage(e.target.value)}
            />
          </>
        )}
      </s-section>

      <s-section heading="Eligible customers">
        {(() => {
          if (!loaderData.metafieldRaw) {
            return (
              <s-banner tone="critical">
                <s-paragraph>Metafield is missing — delete and recreate this single code, then run Sync customer tags in Settings.</s-paragraph>
              </s-banner>
            );
          }
          let cfg: Record<string, unknown> = {};
          try { cfg = JSON.parse(loaderData.metafieldRaw); } catch {}
          const eligible = Array.isArray(cfg.eligibleCustomerIds) ? (cfg.eligibleCustomerIds as unknown[]).length : null;
          const blockedCount = Array.isArray(cfg.blockedCustomerIds) ? (cfg.blockedCustomerIds as unknown[]).length : null;
          if (eligible === null) {
            return (
              <s-banner tone="warning">
                <s-paragraph>No eligible customers synced yet. Go to Settings → Sync customer tags after adding the required tag to customers in Shopify admin.</s-paragraph>
              </s-banner>
            );
          }
          return (
            <div style={{ display: "flex", gap: "24px" }}>
              <div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Eligible</div>
                <span style={{ fontSize: "16px", fontWeight: 500 }}>{eligible} customer{eligible !== 1 ? "s" : ""}</span>
              </div>
              {blockedCount !== null && (
                <div>
                  <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Blocked (limit reached)</div>
                  <span style={{ fontSize: "16px", fontWeight: 500 }}>{blockedCount} customer{blockedCount !== 1 ? "s" : ""}</span>
                </div>
              )}
            </div>
          );
        })()}
      </s-section>

      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
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
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
