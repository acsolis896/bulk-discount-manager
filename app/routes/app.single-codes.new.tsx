import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { checkCodeQuota } from "../billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const formData = await request.formData();

  const title = String(formData.get("title") || "").trim();
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const discountType = String(formData.get("discountType") || "percentage") === "fixedAmount" ? "fixedAmount" : "percentage";
  const percentage = Number(formData.get("percentage") || 0);
  const fixedAmount = Number(formData.get("fixedAmount") || 0);
  const oncePerOrder = formData.get("oncePerOrder") !== "0";
  const requiredTag = String(formData.get("requiredTag") || "").trim();
  const blockedTag = String(formData.get("blockedTag") || "").trim();
  const endsAtRaw = String(formData.get("endsAt") || "");
  const endsAt = endsAtRaw ? new Date(endsAtRaw).toISOString() : null;
  const combinesWithProduct = formData.get("combinesWithProduct") === "1";
  const combinesWithOrder = formData.get("combinesWithOrder") === "1";
  const combinesWithShipping = formData.get("combinesWithShipping") === "1";
  const productIds: string[] = JSON.parse(String(formData.get("productIds") || "[]"));
  const collectionIds: string[] = JSON.parse(String(formData.get("collectionIds") || "[]"));

  if (!title) return { error: "Title is required." };
  if (!code) return { error: "Discount code is required." };
  if (discountType === "percentage") {
    if (!percentage || percentage < 1 || percentage > 100) return { error: "Percentage must be between 1 and 100." };
  } else {
    if (!fixedAmount || fixedAmount <= 0) return { error: "Fixed amount must be greater than 0." };
  }
  if (productIds.length === 0 && collectionIds.length === 0) return { error: "Select at least one eligible product or collection." };

  const quota = await checkCodeQuota(admin, billing, 1);
  if (!quota.allowed) {
    return {
      error: `Your ${quota.tier} plan allows up to ${quota.limit} active discount codes (currently using ${quota.current}). Upgrade on the Plans page to create more.`,
    };
  }

  // Expand collections to product IDs
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
  if (resolvedProductIds.length === 0) return { error: "No products found in the selected collections." };

  // Fetch blocked product types
  const blockedRows = await db.blockedProductType.findMany({
    where: { shop: session.shop },
    select: { productType: true },
  });
  const blockedProductTypes = blockedRows.length > 0
    ? blockedRows.map((r: { productType: string }) => r.productType)
    : ["GWP"];

  // Create discount
  const createRes = await admin.graphql(
    `#graphql
    mutation CreateSingleCodeDiscount($input: DiscountCodeAppInput!) {
      discountCodeAppCreate(codeAppDiscount: $input) {
        codeAppDiscount { discountId }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          title,
          functionHandle: "discount-rejection-function-js",
          startsAt: new Date().toISOString(),
          ...(endsAt ? { endsAt } : {}),
          code,
          discountClasses: ["PRODUCT"],
          combinesWith: {
            productDiscounts: combinesWithProduct,
            orderDiscounts: combinesWithOrder,
            shippingDiscounts: combinesWithShipping,
          },
        },
      },
    }
  );
  const createData = await createRes.json();
  const createErrors = createData.data?.discountCodeAppCreate?.userErrors ?? [];
  if (createErrors.length > 0) {
    return { error: `Creating discount: ${createErrors.map((e: { message: string }) => e.message).join(", ")}` };
  }
  const appDiscountId = createData.data?.discountCodeAppCreate?.codeAppDiscount?.discountId;
  if (!appDiscountId) return { error: "Failed to create discount." };

  // discountCodeAppCreate returns a DiscountCodeApp GID. The valid ownerId type for
  // metafieldsSet is DiscountCodeNode (same numeric ID, different prefix).
  const numericId = appDiscountId.split("/").pop();
  const nodeDiscountId = `gid://shopify/DiscountCodeNode/${numericId}`;

  const metafieldConfig = JSON.stringify({
    productIds: resolvedProductIds,
    collectionIds,
    discountType,
    ...(discountType === "fixedAmount" ? { fixedAmount } : { percentage }),
    oncePerOrder,
    blockedProductTypes,
    requiredTag,
    blockedTag,
  });
  const mfRes = await admin.graphql(
    `#graphql
    mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [{
          ownerId: nodeDiscountId,
          namespace: "$app",
          key: "function-configuration",
          type: "json",
          value: metafieldConfig,
        }],
      },
    }
  );
  const mfData = await mfRes.json();
  const mfErrors = mfData.data?.metafieldsSet?.userErrors ?? [];
  if (mfErrors.length > 0) {
    return { error: `Discount created but config save failed: ${mfErrors.map((e: { message: string }) => e.message).join(", ")}` };
  }

  // Scan discountNodes to find the real function node (may differ from construction node)
  let functionNodeId: string | null = null;
  try {
    const scanRes = await admin.graphql(
      `#graphql
      query FindFunctionNode($after: String) {
        discountNodes(first: 50, query: "function_id:discount-rejection-function-js") {
          nodes {
            id
            discount {
              ... on DiscountCodeApp {
                codes(first: 1) { nodes { code } }
              }
            }
          }
        }
      }`,
      { variables: { after: null } }
    );
    const scanData = await scanRes.json();
    for (const n of scanData.data?.discountNodes?.nodes ?? []) {
      if (!n.id.includes("DiscountCodeNode")) continue;
      const nodeCode = n.discount?.codes?.nodes?.[0]?.code?.toUpperCase();
      if (nodeCode === code) { functionNodeId = n.id; break; }
    }
  } catch { /* ignore — functionNodeId stays null, global sync will find it */ }

  // If real node differs from construction node, write config there too
  if (functionNodeId && functionNodeId !== nodeDiscountId) {
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
            ownerId: functionNodeId,
            namespace: "$app",
            key: "function-configuration",
            type: "json",
            value: metafieldConfig,
          }],
        },
      }
    );
  }

  await db.singleCodeDiscount.create({
    data: {
      shop: session.shop,
      discountId: nodeDiscountId,
      code,
      requiredTag,
      blockedTag,
      configJson: metafieldConfig,
      functionNodeId: functionNodeId !== nodeDiscountId ? functionNodeId : null,
    },
  });

  return { success: true, numericId };
};

export default function NewSingleCodePage() {
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixedAmount">("percentage");
  const [percentage, setPercentage] = useState("50");
  const [fixedAmount, setFixedAmount] = useState("10");
  const [oncePerOrder, setOncePerOrder] = useState(true);
  const [requiredTag, setRequiredTag] = useState("");
  const [blockedTag, setBlockedTag] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [productTitles, setProductTitles] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [collectionTitles, setCollectionTitles] = useState<string[]>([]);
  const [pickerMode, setPickerMode] = useState<"product" | "collection">("collection");
  const [combinesWithProduct, setCombinesWithProduct] = useState(false);
  const [combinesWithOrder, setCombinesWithOrder] = useState(false);
  const [combinesWithShipping, setCombinesWithShipping] = useState(false);

  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data as { error?: string; success?: boolean; numericId?: string } | undefined;

  useEffect(() => {
    if (result?.success && result.numericId) {
      navigate(`/app/single-codes/${result.numericId}`);
    }
  }, [result, navigate]);

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
      setPickerMode("product");
    }
  }, [shopify, productIds]);

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
      setPickerMode("collection");
    }
  }, [shopify, collectionIds]);

  const handleSubmit = () => {
    const form = new FormData();
    form.set("title", title);
    form.set("code", code);
    form.set("discountType", discountType);
    form.set("percentage", percentage);
    form.set("fixedAmount", fixedAmount);
    form.set("oncePerOrder", oncePerOrder ? "1" : "0");
    form.set("requiredTag", requiredTag);
    form.set("blockedTag", blockedTag);
    form.set("endsAt", endsAt);
    form.set("productIds", JSON.stringify(productIds));
    form.set("collectionIds", JSON.stringify(collectionIds));
    form.set("combinesWithProduct", combinesWithProduct ? "1" : "0");
    form.set("combinesWithOrder", combinesWithOrder ? "1" : "0");
    form.set("combinesWithShipping", combinesWithShipping ? "1" : "0");
    fetcher.submit(form, { method: "post" });
  };

  const selectedLabel = collectionIds.length > 0
    ? `${collectionIds.length} collection${collectionIds.length > 1 ? "s" : ""}: ${collectionTitles.join(", ")}`
    : productIds.length > 0
      ? `${productIds.length} product${productIds.length > 1 ? "s" : ""}: ${productTitles.join(", ")}`
      : null;

  return (
    <s-page heading="Create reusable code">
      {result?.error && (
        <s-banner tone="critical" style={{ marginBottom: "16px" }}>
          <s-paragraph>{result.error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Details">
        <s-text-field
          label="Title"
          value={title}
          placeholder="e.g. Guide 50% Discount"
          helpText="Shown in the Shopify admin discounts list"
          onInput={(e: { target: { value: string } }) => setTitle(e.target.value)}
        />
        <s-text-field
          label="Discount code"
          value={code}
          placeholder="e.g. GUIDE50"
          helpText="The code customers enter at checkout"
          onInput={(e: { target: { value: string } }) => setCode(e.target.value.toUpperCase())}
        />
        <s-stack direction="block" gap="tight">
          <s-text emphasis="bold" style={{ fontSize: "14px" }}>Discount value</s-text>
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
        </s-stack>
        <s-stack direction="block" gap="none">
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input type="checkbox" checked={oncePerOrder} onChange={(e) => setOncePerOrder(e.target.checked)} />
            Only apply discount once per order
          </label>
          <s-text style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>
            {oncePerOrder
              ? "Applies to the highest-priced eligible item in the cart — 1 unit only."
              : "The discount will be taken off every eligible item in the cart."}
          </s-text>
        </s-stack>
        <s-text-field
          label="Expiry date (optional)"
          type="date"
          value={endsAt}
          onInput={(e: { target: { value: string } }) => setEndsAt(e.target.value)}
        />
      </s-section>

      <s-section heading="Eligible items">
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <s-button onClick={handlePickCollections}>Browse collections</s-button>
          <s-button onClick={handlePickProducts}>Browse products</s-button>
        </div>
        {selectedLabel ? (
          <s-paragraph>{selectedLabel}</s-paragraph>
        ) : (
          <s-paragraph>No items selected yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Customer eligibility">
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
      </s-section>

      <s-section heading="Combinations">
        <s-paragraph>By default, this discount cannot be combined with other discounts.</s-paragraph>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
          <s-checkbox
            label="Product discounts"
            checked={combinesWithProduct}
            onChange={(e: { target: { checked: boolean } }) => setCombinesWithProduct(e.target.checked)}
          />
          <s-checkbox
            label="Order discounts"
            checked={combinesWithOrder}
            onChange={(e: { target: { checked: boolean } }) => setCombinesWithOrder(e.target.checked)}
          />
          <s-checkbox
            label="Shipping discounts"
            checked={combinesWithShipping}
            onChange={(e: { target: { checked: boolean } }) => setCombinesWithShipping(e.target.checked)}
          />
        </div>
      </s-section>

      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <s-button
          variant="primary"
          disabled={isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? "Creating..." : "Create discount"}
        </s-button>
        <s-button onClick={() => navigate("/app/single-codes")}>Cancel</s-button>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
