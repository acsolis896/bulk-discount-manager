import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useNavigate, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { numericInputHandler } from "../numeric-input";
import { MAX_DISCOUNTED_ITEMS_ENABLED, useCountryRestrictionEnabled } from "../feature-flags";
import { getShopCurrencyCode } from "../shop.server";
import { saveFunctionConfig, configSizeProblem, splitCollections, expandCollectionProducts } from "../function-config.server";
import { CountryPicker } from "../components/CountryPicker";
import { UpgradeNote } from "../components/UpgradeNote";
import { parseAllowedCountries } from "../countries";
import { checkReusableQuota, getPlanFeatures } from "../billing.server";
import { isFeatureBlocked, featureBlockedMessage, type PlanFeature } from "../billing";
import { applyEligibility, listSegments } from "../eligibility.server";
import { shouldRequestReviewAfterCreation } from "../review-prompt";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const segments = await listSegments(admin);
  const currencyCode = await getShopCurrencyCode(admin);
  const features = await getPlanFeatures(billing, session.shop);
  return { segments, currencyCode, features };
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
  const maxItemsRaw = String(formData.get("maxDiscountedItems") || "").trim();
  const parsedMaxItems = !oncePerOrder && maxItemsRaw ? Number(maxItemsRaw) : null;
  if (parsedMaxItems !== null && (!Number.isFinite(parsedMaxItems) || parsedMaxItems < 1)) {
    return { error: "Max items discounted must be a whole number of 1 or more." };
  }
  const maxDiscountedItems = parsedMaxItems !== null ? Math.floor(parsedMaxItems) : null;
  const countriesResult = parseAllowedCountries(String(formData.get("allowedCountries") || ""));
  if ("error" in countriesResult) return { error: countriesResult.error };
  const allowedCountries = countriesResult.countries;
  const usesPerCustomerLimitRaw = String(formData.get("usesPerCustomerLimit") || "").trim();
  const parsedUsesLimit = usesPerCustomerLimitRaw ? Number(usesPerCustomerLimitRaw) : null;
  if (parsedUsesLimit !== null && (!Number.isFinite(parsedUsesLimit) || parsedUsesLimit < 1)) {
    return { error: "Uses per customer must be a whole number of 1 or more." };
  }
  const usesPerCustomerLimit = parsedUsesLimit !== null ? Math.floor(parsedUsesLimit) : null;

  const maxCartItemsRaw = String(formData.get("maxCartItems") || "").trim();
  const parsedMaxCartItems = maxCartItemsRaw ? Number(maxCartItemsRaw) : null;
  if (parsedMaxCartItems !== null && (!Number.isFinite(parsedMaxCartItems) || parsedMaxCartItems < 1)) {
    return { error: "Maximum items in the cart must be a whole number of 1 or more." };
  }
  const maxCartItems = parsedMaxCartItems !== null ? Math.floor(parsedMaxCartItems) : null;

  const maxDiscountAmountRaw = String(formData.get("maxDiscountAmount") || "").trim();
  const parsedMaxDiscountAmount = discountType === "percentage" && maxDiscountAmountRaw ? Number(maxDiscountAmountRaw) : null;
  if (parsedMaxDiscountAmount !== null && (!Number.isFinite(parsedMaxDiscountAmount) || parsedMaxDiscountAmount <= 0)) {
    return { error: "Maximum discount amount must be greater than 0." };
  }
  const maxDiscountAmount = parsedMaxDiscountAmount !== null ? Math.round(parsedMaxDiscountAmount * 100) / 100 : null;
  const eligibilityMode = (["all", "tags", "segment"] as const).includes(String(formData.get("eligibilityMode")) as "all" | "tags" | "segment")
    ? (String(formData.get("eligibilityMode")) as "all" | "tags" | "segment")
    : "all";
  const requiredTag = eligibilityMode === "tags" ? String(formData.get("requiredTag") || "").trim() : "";
  const blockedTag = eligibilityMode === "tags" ? String(formData.get("blockedTag") || "").trim() : "";
  const selectedSegmentId = String(formData.get("segmentId") || "").trim();
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

  const quota = await checkReusableQuota(admin, billing, session.shop);
  if (!quota.allowed) {
    return {
      error: `Your ${quota.tier} plan allows up to ${quota.limit} reusable code${quota.limit === 1 ? "" : "s"} (you have ${quota.current}). Upgrade on the Plans page to create more.`,
    };
  }

  // Features that need a paid plan (existing codes are never affected; this only applies when creating).
  const lockedFeatures: [PlanFeature, boolean][] = [
    ["countryRestriction", allowedCountries.length > 0],
    ["discountCap", maxDiscountAmount !== null],
  ["tagTargeting", eligibilityMode !== "all"],
  ];
  for (const [feature, isSet] of lockedFeatures) {
    if (isFeatureBlocked(quota.tier, session.shop, feature, { isSet, wasSet: false })) {
      return { error: featureBlockedMessage(feature, quota.tier) };
    }
  }

  // Up to 100 collections are matched live at checkout, so the config stores only their IDs (a
  // long product list can pass the 10,000-byte limit Shopify applies to what a Function can read).
  // Over 100, Shopify can't take them as a list variable, so list the products in them instead.
  const { liveCollectionIds, expandCollectionIds } = splitCollections(collectionIds);
  let resolvedProductIds = [...productIds];
  if (expandCollectionIds.length > 0) {
    const expanded = await expandCollectionProducts(admin, expandCollectionIds);
    if (expanded.error) return { error: expanded.error };
    resolvedProductIds = [...new Set([...resolvedProductIds, ...expanded.productIds])];
  }
  if (resolvedProductIds.length === 0 && liveCollectionIds.length === 0) {
    return {
      error: expandCollectionIds.length > 0
        ? "No products found in the selected collections. If you just created or edited them, wait a few minutes for Shopify to finish updating, then try again."
        : "Select at least one eligible product or collection.",
    };
  }

  const sizeProblem = configSizeProblem(resolvedProductIds);
  if (sizeProblem) return { error: sizeProblem };

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
    ...(liveCollectionIds.length > 0 ? { liveCollectionIds } : {}),
    discountType,
    ...(discountType === "fixedAmount" ? { fixedAmount } : { percentage }),
    oncePerOrder,
    ...(maxDiscountedItems !== null ? { maxDiscountedItems } : {}),
    ...(maxDiscountAmount !== null ? { maxDiscountAmount } : {}),
    ...(maxCartItems !== null ? { maxCartItems } : {}),
    ...(allowedCountries.length > 0 ? { allowedCountries } : {}),
    blockedProductTypes,
    requiredTag,
    blockedTag,
    ...(usesPerCustomerLimit !== null ? { usesPerCustomerLimit, usageCappedCustomerIds: [] } : {}),
  });
  const saved = await saveFunctionConfig(admin, {
    ownerId: nodeDiscountId,
    readId: nodeDiscountId,
    value: metafieldConfig,
  });
  if (!saved.ok) {
    // Don't leave a discount behind that exists but can never apply.
    try {
      await admin.graphql(
        `#graphql
        mutation DeleteUnconfiguredDiscount($id: ID!) {
          discountCodeDelete(id: $id) { userErrors { message } }
        }`,
        { variables: { id: nodeDiscountId } }
      );
    } catch { /* best effort */ }
    return { error: `Config save failed: ${saved.message}. Nothing was created, please try again.` };
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

  let eligibilityWarning: string | null = null;
  if (eligibilityMode !== "all") {
    eligibilityWarning = await applyEligibility(
      admin,
      nodeDiscountId,
      `${code} Eligible`,
      eligibilityMode,
      requiredTag,
      blockedTag,
      selectedSegmentId
    );
  }

  await db.singleCodeDiscount.create({
    data: {
      shop: session.shop,
      discountId: nodeDiscountId,
      code,
      requiredTag,
      blockedTag,
      eligibilityMode,
      segmentId: eligibilityMode === "segment" ? selectedSegmentId : null,
      configJson: metafieldConfig,
      usesPerCustomerLimit,
      functionNodeId: functionNodeId !== nodeDiscountId ? functionNodeId : null,
    },
  });

  return { success: true, numericId, eligibilityWarning };
};

export default function NewSingleCodePage() {
  const countryRestrictionEnabled = useCountryRestrictionEnabled();
  const { segments, currencyCode, features } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixedAmount">("percentage");
  const [percentage, setPercentage] = useState("50");
  const [fixedAmount, setFixedAmount] = useState("10");
  const [oncePerOrder, setOncePerOrder] = useState(true);
  const [maxDiscountedItems, setMaxDiscountedItems] = useState("");
  const [allowedCountries, setAllowedCountries] = useState<string[]>([]);
  const [usesPerCustomerLimit, setUsesPerCustomerLimit] = useState("");
  const [maxCartItems, setMaxCartItems] = useState("");
  const [maxDiscountAmount, setMaxDiscountAmount] = useState("");
  const [eligibilityMode, setEligibilityMode] = useState<"all" | "tags" | "segment">("all");
  const [requiredTag, setRequiredTag] = useState("");
  const [blockedTag, setBlockedTag] = useState("");
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
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
  const result = fetcher.data as { error?: string; success?: boolean; numericId?: string; eligibilityWarning?: string | null } | undefined;

  useEffect(() => {
    if (result?.success && result.numericId && !result.eligibilityWarning) {
      if (shouldRequestReviewAfterCreation()) {
        shopify.reviews.request().catch(() => {});
      }
      navigate(`/app/single-codes/${result.numericId}`);
    }
  }, [result, navigate, shopify]);

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
    form.set("maxDiscountedItems", maxDiscountedItems);
    form.set("allowedCountries", JSON.stringify(allowedCountries));
    form.set("usesPerCustomerLimit", usesPerCustomerLimit);
    form.set("maxCartItems", maxCartItems);
    form.set("maxDiscountAmount", maxDiscountAmount);
    form.set("eligibilityMode", eligibilityMode);
    form.set("requiredTag", requiredTag);
    form.set("blockedTag", blockedTag);
    form.set("segmentId", selectedSegmentId);
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

      {result?.success && result.eligibilityWarning && (
        <s-banner tone="warning" style={{ marginBottom: "16px" }}>
          <s-paragraph>
            Code created, but customer eligibility couldn't be applied: {result.eligibilityWarning}
          </s-paragraph>
          <s-button onClick={() => navigate(`/app/single-codes/${result.numericId}`)}>Continue</s-button>
        </s-banner>
      )}

      <s-section heading="Details">
        <s-text-field
          label="Title"
          value={title}
          placeholder="e.g. Guide 50% Discount"
          details="The discount title will be shown in the Shopify admin, not visible to customers at checkout"
          onInput={(e: { target: { value: string } }) => setTitle(e.target.value)}
        />
        <s-text-field
          label="Discount code"
          value={code}
          placeholder="e.g. GUIDE50"
          details="The code customers enter at checkout"
          onInput={(e: { target: { value: string } }) => setCode(e.target.value.toUpperCase())}
        />
        <div style={{ marginTop: "16px" }}>
          <s-stack direction="block" gap="small">
            <s-text emphasis="bold" style={{ fontSize: "14px" }}>Discount value</s-text>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {(["percentage", "fixedAmount"] as const).map((type) => (
                <s-button
                  key={type}
                  variant={discountType === type ? "primary" : "secondary"}
                  onClick={() => setDiscountType(type)}
                >
                  {type === "percentage" ? "Percentage" : "Fixed amount"}
                </s-button>
              ))}
            </div>
            {discountType === "percentage" ? (
              <>
                <s-number-field
                  label="Discount percentage"
                  inputMode="decimal"
                  value={percentage}
                  min={1}
                  max={100}
                  details="Percentage off the eligible product"
                  onInput={numericInputHandler("decimal", setPercentage)}
                />
                {features.discountCap ? (
                <s-number-field
                  label={`Maximum discount per order${currencyCode ? ` (${currencyCode})` : ""} (optional)`}
                  inputMode="decimal"
                  value={maxDiscountAmount}
                  min={0.01}
                  step={0.01}
                  placeholder="No cap"
                  details="Leave blank for no cap. If the percentage comes to more than this amount on an order, the discount is limited to this amount. Enter it in your store's currency."
                  onInput={numericInputHandler("decimal", setMaxDiscountAmount)}
                />
                ) : (
                  <UpgradeNote feature="discountCap" />
                )}
              </>
            ) : (
              <s-number-field
                label="Amount off"
                inputMode="decimal"
                value={fixedAmount}
                min={0.01}
                step={0.01}
                prefix="$"
                details="Fixed amount off the eligible product"
                onInput={numericInputHandler("decimal", setFixedAmount)}
              />
            )}
          </s-stack>
        </div>
        <div style={{ marginTop: "16px" }}>
          <s-checkbox
            label="Only apply discount once per order"
            checked={oncePerOrder}
            onChange={(e: { target: { checked: boolean } }) => setOncePerOrder(e.target.checked)}
            details={
              oncePerOrder
                ? "Applies to the highest-priced eligible item in the cart — 1 unit only."
                : maxDiscountedItems.trim()
                  ? `The discount will be taken off up to ${maxDiscountedItems.trim()} eligible items in the cart, highest-priced first.`
                  : "The discount will be taken off every eligible item in the cart."
            }
          />
        </div>
        {MAX_DISCOUNTED_ITEMS_ENABLED && !oncePerOrder && (
          <div style={{ marginTop: "12px", marginLeft: "22px", paddingLeft: "12px", borderLeft: "2px solid #c9cccf" }}>
            <s-number-field
              label="Max items discounted (optional)"
              inputMode="numeric"
              min={1}
              step={1}
              value={maxDiscountedItems}
              placeholder="All eligible items"
              details="Leave blank to discount every eligible item. Set a number to cap how many items get the discount per order — the highest-priced items are discounted first."
              onInput={numericInputHandler("integer", setMaxDiscountedItems)}
            />
          </div>
        )}
        <div style={{ marginTop: "16px" }}>
          <s-number-field
            label="Limit uses per customer (optional)"
            inputMode="numeric"
            value={usesPerCustomerLimit}
            min={1}
            placeholder="Unlimited"
            details="Leave blank for unlimited uses. Set a number to cap how many times each customer can redeem this code — e.g. 5."
            onInput={numericInputHandler("integer", setUsesPerCustomerLimit)}
          />
        </div>
        <div style={{ marginTop: "16px" }}>
          <s-number-field
            label="Maximum items in the cart (optional)"
            inputMode="numeric"
            value={maxCartItems}
            min={1}
            placeholder="No limit"
            details="Leave blank for no limit. Set a number to stop this code applying when the cart holds more than that many items in total, counting every product and quantity. Use 1 for single-item orders only."
            onInput={numericInputHandler("integer", setMaxCartItems)}
          />
        </div>
        <div style={{ marginTop: "16px" }}>
          <s-date-field
            label="Expiration date (optional)"
            value={endsAt}
            onChange={(e: InputEvent) => setEndsAt((e.target as HTMLInputElement).value)}
          />
        </div>
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

      {countryRestrictionEnabled && (
        <s-section heading="Countries">
          {features.countryRestriction ? (
            <CountryPicker value={allowedCountries} onChange={setAllowedCountries} />
          ) : (
            <UpgradeNote feature="countryRestriction" />
          )}
        </s-section>
      )}

      <s-section heading="Customer eligibility">
        <s-stack direction="block" gap="small">
          <s-paragraph>Choose which customers can use this code.</s-paragraph>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {(["all", "tags", "segment"] as const)
            .filter((mode) => mode === "all" || features.tagTargeting || eligibilityMode === mode)
            .map((mode) => (
              <s-button
                key={mode}
                variant={eligibilityMode === mode ? "primary" : "secondary"}
                onClick={() => setEligibilityMode(mode)}
              >
                {mode === "all" ? "All customers" : mode === "tags" ? "Customer tags" : "Existing segment"}
              </s-button>
            ))}
          </div>
          {!features.tagTargeting && <UpgradeNote feature="tagTargeting" />}

          {eligibilityMode === "tags" && (
            <>
              <s-text-field
                label="Required customer tag"
                value={requiredTag}
                placeholder="e.g. GUIDE50"
                details="Customers must have this tag to use the code"
                onInput={(e: { target: { value: string } }) => setRequiredTag(e.target.value)}
              />
              <s-text-field
                label="Blocked customer tag"
                value={blockedTag}
                placeholder="e.g. GUIDE50-USED"
                details="Customers with this tag will be rejected (usage limit reached)"
                onInput={(e: { target: { value: string } }) => setBlockedTag(e.target.value)}
              />
            </>
          )}

          {eligibilityMode === "segment" && (
            <s-select
              label="Customer segment"
              placeholder="Select a segment…"
              value={selectedSegmentId}
              onChange={(e: InputEvent) => setSelectedSegmentId((e.target as HTMLSelectElement).value)}
            >
              {segments.map((s: { id: string; name: string }) => (
                <s-option key={s.id} value={s.id}>{s.name}</s-option>
              ))}
            </s-select>
          )}
        </s-stack>
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
