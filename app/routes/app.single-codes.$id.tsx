import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { numericInputHandler } from "../numeric-input";
import { MAX_DISCOUNTED_ITEMS_ENABLED, useCountryRestrictionEnabled } from "../feature-flags";
import { getShopCurrencyCode } from "../shop.server";
import { getCurrentPlan, getPlanFeatures } from "../billing.server";
import { isFeatureBlocked, featureBlockedMessage, type PlanFeature } from "../billing";
import { configSizeProblem, splitCollections, expandCollectionProducts } from "../function-config.server";
import { CountryPicker } from "../components/CountryPicker";
import { UpgradeNote } from "../components/UpgradeNote";
import { CardTitle } from "../components/CardTitle";
import { parseAllowedCountries } from "../countries";
import { applyEligibility, listSegments } from "../eligibility.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const numericId = params.id!;
  const discountId = `gid://shopify/DiscountCodeNode/${numericId}`;

  const row = await db.singleCodeDiscount.findFirst({
    where: { shop: session.shop, discountId },
  });
  if (!row) throw new Response("Not found", { status: 404 });

  const segments = await listSegments(admin);
  const eligibilityMode: "all" | "tags" | "segment" =
    row.eligibilityMode === "tags" || row.eligibilityMode === "segment"
      ? row.eligibilityMode
      : row.requiredTag
        ? "tags"
        : "all";

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
            usageLimit
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

  // Revenue/last-used come from our own order-webhook ledger — Shopify
  // exposes a usage count (asyncUsageCount above) but no revenue per code.
  const redemptionTotals = await db.codeRedemption.aggregate({
    where: { shop: session.shop, discountId },
    _sum: { totalPrice: true },
    _max: { createdAt: true },
  });
  const revenue = redemptionTotals._sum.totalPrice ?? 0;
  const lastUsed = redemptionTotals._max.createdAt ? redemptionTotals._max.createdAt.toISOString() : null;

  return {
    dbId: row.id,
    discountId,
    numericId,
    code: row.code,
    requiredTag: row.requiredTag,
    blockedTag: row.blockedTag,
    eligibilityMode,
    segmentId: row.segmentId ?? "",
    segments,
    title: discount?.title ?? row.code,
    status: discount?.status ?? "UNKNOWN",
    usageCount: discount?.asyncUsageCount ?? 0,
    usageLimit: discount?.usageLimit ?? null,
    revenue,
    lastUsed,
    startsAt: discount?.startsAt ?? null,
    endsAt: discount?.endsAt ?? null,
    combinesWith: discount?.combinesWith ?? { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
    discountType: config.discountType === "fixedAmount" ? "fixedAmount" : "percentage",
    percentage: config.percentage ?? null,
    fixedAmount: config.fixedAmount ?? null,
    oncePerOrder: config.oncePerOrder !== false,
    allowedCountries: Array.isArray(config.allowedCountries) ? (config.allowedCountries as string[]) : [],
    maxDiscountedItems: Number.isInteger(config.maxDiscountedItems) && (config.maxDiscountedItems as number) > 0 ? (config.maxDiscountedItems as number) : null,
    maxCartItems: Number.isInteger(config.maxCartItems) && (config.maxCartItems as number) > 0 ? (config.maxCartItems as number) : null,
    maxDiscountAmount: typeof config.maxDiscountAmount === "number" && config.maxDiscountAmount > 0 ? (config.maxDiscountAmount as number) : null,
    currencyCode: await getShopCurrencyCode(admin),
    features: await getPlanFeatures(billing, session.shop, {
      countryRestriction: Array.isArray(config.allowedCountries) && config.allowedCountries.length > 0,
      discountCap: typeof config.maxDiscountAmount === "number",
      usesPerCustomer: row.usesPerCustomerLimit != null,
      maxCartItems: Number.isInteger(config.maxCartItems) && (config.maxCartItems as number) > 0,
    }),
    productIds,
    collectionIds,
    collectionTitles,
    blockedProductTypes: (config.blockedProductTypes as string[]) ?? [],
    usesPerCustomerLimit: row.usesPerCustomerLimit,
    usageCappedCount: Array.isArray(config.usageCappedCustomerIds) ? config.usageCappedCustomerIds.length : 0,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const numericId = params.id!;
  const discountId = `gid://shopify/DiscountCodeNode/${numericId}`;
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "updateConfig") {
    const eligibilityMode = (["all", "tags", "segment"] as const).includes(String(formData.get("eligibilityMode")) as "all" | "tags" | "segment")
      ? (String(formData.get("eligibilityMode")) as "all" | "tags" | "segment")
      : "all";
    const requiredTag = eligibilityMode === "tags" ? String(formData.get("requiredTag") || "").trim() : "";
    const blockedTag = eligibilityMode === "tags" ? String(formData.get("blockedTag") || "").trim() : "";
    const selectedSegmentId = String(formData.get("segmentId") || "").trim();
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
    const productIds: string[] = JSON.parse(String(formData.get("productIds") || "[]"));
    const collectionIds: string[] = JSON.parse(String(formData.get("collectionIds") || "[]"));
    const usageLimitRaw = Number(formData.get("usageLimit") || 0);
    const usageLimit = usageLimitRaw > 0 ? Math.floor(usageLimitRaw) : null;
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

    if (discountType === "percentage") {
      if (!percentage || percentage < 1 || percentage > 100) return { error: "Percentage must be between 1 and 100." };
    } else {
      if (!fixedAmount || fixedAmount <= 0) return { error: "Fixed amount must be greater than 0." };
    }
    if (productIds.length === 0 && collectionIds.length === 0) return { error: "Select at least one eligible product or collection." };

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

    // Look up functionNodeId from DB
    const dbRow = await db.singleCodeDiscount.findFirst({ where: { shop: session.shop, discountId }, select: { functionNodeId: true, code: true, eligibilityMode: true, usesPerCustomerLimit: true } });
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

    // Features that need a paid plan can't be newly turned on from a lower plan; ones this code
    // already has stay editable, so nobody loses what they have.
    const { tier } = await getCurrentPlan(billing);
    const lockedFeatures: [PlanFeature, boolean, boolean][] = [
      ["countryRestriction", allowedCountries.length > 0, Array.isArray(existing.allowedCountries) && existing.allowedCountries.length > 0],
      ["discountCap", maxDiscountAmount !== null, typeof existing.maxDiscountAmount === "number"],
      ["usesPerCustomer", usesPerCustomerLimit !== null, dbRow?.usesPerCustomerLimit != null],
      ["maxCartItems", maxCartItems !== null, Number.isInteger(existing.maxCartItems) && (existing.maxCartItems as number) > 0],
    ];
    for (const [feature, isSet, wasSet] of lockedFeatures) {
      if (isFeatureBlocked(tier, session.shop, feature, { isSet, wasSet })) {
        return { error: featureBlockedMessage(feature, tier) };
      }
    }

    // The maximum total uses is Shopify's own usageLimit field. Saved first, so a failure here
    // stops the save before any other setting has changed.
    const appDiscountId = discountId.replace("DiscountCodeNode", "DiscountCodeApp");
    const limitRes = await admin.graphql(
      `#graphql
      mutation UpdateUsageLimit($id: ID!, $input: DiscountCodeAppInput!) {
        discountCodeAppUpdate(id: $id, codeAppDiscount: $input) {
          userErrors { field message }
        }
      }`,
      { variables: { id: appDiscountId, input: { usageLimit } } }
    );
    const limitData = (await limitRes.json()) as {
      data?: { discountCodeAppUpdate?: { userErrors?: { message: string }[] } | null };
      errors?: { message?: string }[];
    };
    const limitErrors = limitData.data?.discountCodeAppUpdate?.userErrors ?? [];
    if (limitErrors.length > 0) {
      return { error: `Updating maximum total uses: ${limitErrors.map((e) => e.message).join(", ")}` };
    }
    if (!limitData.data?.discountCodeAppUpdate) {
      return { error: `Updating maximum total uses: ${limitData.errors?.[0]?.message ?? "Shopify did not confirm the change"}.` };
    }

    const newConfig = {
      ...existing,
      productIds: resolvedProductIds,
      collectionIds,
      liveCollectionIds: liveCollectionIds.length > 0 ? liveCollectionIds : undefined,
      discountType,
      percentage: discountType === "percentage" ? percentage : undefined,
      fixedAmount: discountType === "fixedAmount" ? fixedAmount : undefined,
      oncePerOrder,
      maxDiscountedItems: maxDiscountedItems ?? undefined,
      maxCartItems: maxCartItems ?? undefined,
      maxDiscountAmount: maxDiscountAmount ?? undefined,
      allowedCountries: allowedCountries.length > 0 ? allowedCountries : undefined,
      requiredTag,
      blockedTag,
      usesPerCustomerLimit,
      // Removing the limit lifts the cap for everyone it applied to.
      usageCappedCustomerIds: usesPerCustomerLimit === null ? [] : (existing.usageCappedCustomerIds ?? []),
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
      liveCollectionIds: liveCollectionIds.length > 0 ? liveCollectionIds : undefined,
      discountType,
      percentage: discountType === "percentage" ? percentage : undefined,
      fixedAmount: discountType === "fixedAmount" ? fixedAmount : undefined,
      oncePerOrder,
      maxDiscountedItems: maxDiscountedItems ?? undefined,
      maxCartItems: maxCartItems ?? undefined,
      maxDiscountAmount: maxDiscountAmount ?? undefined,
      allowedCountries: allowedCountries.length > 0 ? allowedCountries : undefined,
      blockedProductTypes: existing.blockedProductTypes ?? ["GWP"],
      requiredTag,
      blockedTag,
      usesPerCustomerLimit,
      usageCappedCustomerIds: usesPerCustomerLimit === null ? [] : (existing.usageCappedCustomerIds ?? []),
    });

    let eligibilityWarning: string | null = null;
    if (eligibilityMode !== "all") {
      eligibilityWarning = await applyEligibility(
        admin,
        discountId,
        `${dbRow?.code ?? numericId} Eligible`,
        eligibilityMode,
        requiredTag,
        blockedTag,
        selectedSegmentId
      );
    }

    await db.singleCodeDiscount.updateMany({
      where: { shop: session.shop, discountId },
      data: {
        requiredTag,
        blockedTag,
        eligibilityMode,
        segmentId: eligibilityMode === "segment" ? selectedSegmentId : null,
        configJson: baseConfigJson,
        usesPerCustomerLimit,
      },
    });

    return { success: true, eligibilityWarning };
  }

  if (intent === "resetUsage") {
    const dbRow = await db.singleCodeDiscount.findFirst({ where: { shop: session.shop, discountId }, select: { functionNodeId: true, configJson: true } });
    if (!dbRow) return { error: "Discount not found." };

    await db.codeUsageCount.deleteMany({ where: { shop: session.shop, discountId } });

    let existing: Record<string, unknown> = {};
    try { if (dbRow.configJson) existing = JSON.parse(dbRow.configJson); } catch { /* empty */ }
    const clearedConfig = { ...existing, usageCappedCustomerIds: [] };
    const clearedConfigJson = JSON.stringify(clearedConfig);

    const writeTargets = [discountId];
    if (dbRow.functionNodeId && dbRow.functionNodeId !== discountId) writeTargets.push(dbRow.functionNodeId);
    for (const ownerId of writeTargets) {
      const res = await admin.graphql(
        `#graphql
        mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
        { variables: { metafields: [{ ownerId, namespace: "$app", key: "function-configuration", type: "json", value: clearedConfigJson }] } }
      );
      const resData = await res.json();
      const errors = resData.data?.metafieldsSet?.userErrors ?? [];
      if (errors.length > 0) {
        return { error: `Failed to reset: ${errors.map((e: { message: string }) => e.message).join(", ")}` };
      }
    }

    await db.singleCodeDiscount.updateMany({ where: { shop: session.shop, discountId }, data: { configJson: clearedConfigJson } });

    return { usageReset: true };
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
  const countryRestrictionEnabled = useCountryRestrictionEnabled();
  const loaderData = useLoaderData<typeof loader>();
  const features = loaderData.features;
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  const [eligibilityMode, setEligibilityMode] = useState<"all" | "tags" | "segment">(loaderData.eligibilityMode);
  const [requiredTag, setRequiredTag] = useState(loaderData.requiredTag);
  const [blockedTag, setBlockedTag] = useState(loaderData.blockedTag);
  const [selectedSegmentId, setSelectedSegmentId] = useState(loaderData.segmentId);
  const [discountType, setDiscountType] = useState<"percentage" | "fixedAmount">(loaderData.discountType);
  const [percentage, setPercentage] = useState(String(loaderData.percentage ?? ""));
  const [fixedAmount, setFixedAmount] = useState(String(loaderData.fixedAmount ?? ""));
  const [oncePerOrder, setOncePerOrder] = useState(loaderData.oncePerOrder);
  const [allowedCountries, setAllowedCountries] = useState<string[]>(loaderData.allowedCountries);
  const [maxDiscountedItems, setMaxDiscountedItems] = useState(loaderData.maxDiscountedItems ? String(loaderData.maxDiscountedItems) : "");
  const [productIds, setProductIds] = useState<string[]>(loaderData.productIds);
  const [productTitles, setProductTitles] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>(loaderData.collectionIds);
  const [collectionTitles, setCollectionTitles] = useState<string[]>(loaderData.collectionTitles);
  const [usageLimit, setUsageLimit] = useState(loaderData.usageLimit != null ? String(loaderData.usageLimit) : "");
  const [usesPerCustomerLimit, setUsesPerCustomerLimit] = useState(String(loaderData.usesPerCustomerLimit ?? ""));
  const [maxCartItems, setMaxCartItems] = useState(loaderData.maxCartItems ? String(loaderData.maxCartItems) : "");
  const [maxDiscountAmount, setMaxDiscountAmount] = useState(loaderData.maxDiscountAmount ? String(loaderData.maxDiscountAmount) : "");

  const isSaving = fetcher.state !== "idle";
  const result = fetcher.data as { error?: string; success?: boolean; deleted?: boolean; eligibilityWarning?: string | null; usageReset?: boolean } | undefined;

  useEffect(() => {
    if (result?.success && !result.eligibilityWarning) shopify.toast.show("Changes saved");
    if (result?.usageReset) shopify.toast.show("Usage counts reset");
    if (result?.deleted) navigate("/app/single-codes");
  }, [result, shopify, navigate]);

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
    form.set("eligibilityMode", eligibilityMode);
    form.set("requiredTag", requiredTag);
    form.set("blockedTag", blockedTag);
    form.set("segmentId", selectedSegmentId);
    form.set("discountType", discountType);
    form.set("percentage", percentage);
    form.set("fixedAmount", fixedAmount);
    form.set("oncePerOrder", oncePerOrder ? "1" : "0");
    form.set("maxDiscountedItems", maxDiscountedItems);
    form.set("allowedCountries", JSON.stringify(allowedCountries));
    form.set("productIds", JSON.stringify(productIds));
    form.set("collectionIds", JSON.stringify(collectionIds));
    form.set("usageLimit", usageLimit);
    form.set("usesPerCustomerLimit", usesPerCustomerLimit);
    form.set("maxCartItems", maxCartItems);
    form.set("maxDiscountAmount", maxDiscountAmount);
    fetcher.submit(form, { method: "post" });
  };

  const handleResetUsage = () => {
    if (!confirm("Reset usage counts for this code? Every customer will be able to redeem it again, up to the limit.")) return;
    const form = new FormData();
    form.set("intent", "resetUsage");
    fetcher.submit(form, { method: "post" });
  };

  const status = loaderData.status;

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

      {result?.success && result.eligibilityWarning && (
        <s-banner tone="warning" style={{ marginBottom: "16px" }}>
          <s-paragraph>Saved, but customer eligibility couldn't be applied: {result.eligibilityWarning}</s-paragraph>
        </s-banner>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <s-section>
          <CardTitle>Overview</CardTitle>
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
              <div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Revenue</div>
                <span style={{ fontSize: "16px", fontWeight: 500 }}>${loaderData.revenue.toFixed(2)}</span>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Last used</div>
                <span style={{ fontSize: "16px", fontWeight: 500 }}>
                  {loaderData.lastUsed ? new Date(loaderData.lastUsed).toLocaleDateString() : "—"}
                </span>
              </div>
            </div>
            {loaderData.usageLimit != null && (
              <div style={{ fontSize: "13px", color: "#6d7175" }}>
                Max total uses: {loaderData.usageLimit.toLocaleString()} ({Math.max(0, loaderData.usageLimit - loaderData.usageCount).toLocaleString()} remaining)
              </div>
            )}
            {loaderData.endsAt && (
              <div style={{ fontSize: "13px", color: "#6d7175" }}>
                Expires: {new Date(loaderData.endsAt).toLocaleDateString()}
              </div>
            )}
            <div style={{ fontSize: "12px", color: "#6d7175" }}>
              Revenue only counts orders placed since code performance tracking started.
            </div>
          </div>
        </s-section>

        <s-section>
          <CardTitle>Discount value</CardTitle>
          <s-stack direction="block" gap="small">
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
                    label={`Maximum discount per order${loaderData.currencyCode ? ` (${loaderData.currencyCode})` : ""} (optional)`}
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

          <div style={{ marginTop: "20px" }}>
            <s-stack direction="block" gap="small">
              <div style={{ fontSize: "14px", fontWeight: 600 }}>Eligible items</div>
              <s-paragraph>
                {collectionIds.length > 0
                  ? `${collectionIds.length} collection${collectionIds.length > 1 ? "s" : ""}: ${collectionTitles.join(", ")}`
                  : productIds.length > 0
                    ? `${productIds.length} product${productIds.length > 1 ? "s" : ""}: ${productTitles.join(", ")}`
                    : "None selected"}
              </s-paragraph>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <s-button onClick={handlePickCollections}>Browse collections</s-button>
                <s-button onClick={handlePickProducts}>Browse products</s-button>
              </div>
            </s-stack>
          </div>

          <div style={{ marginTop: "20px" }}>
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
        </s-section>

        <s-section>
          <CardTitle>Eligibility</CardTitle>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <div style={{ fontSize: "14px", fontWeight: 600 }}>Customers</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(["all", "tags", "segment"] as const).map((mode) => (
                  <s-button
                    key={mode}
                    variant={eligibilityMode === mode ? "primary" : "secondary"}
                    onClick={() => setEligibilityMode(mode)}
                  >
                    {mode === "all" ? "All customers" : mode === "tags" ? "Customer tags" : "Existing segment"}
                  </s-button>
                ))}
              </div>

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
                  {loaderData.segments.map((s: { id: string; name: string }) => (
                    <s-option key={s.id} value={s.id}>{s.name}</s-option>
                  ))}
                </s-select>
              )}
            </s-stack>

            {countryRestrictionEnabled && (
              <s-stack direction="block" gap="small">
                <div style={{ fontSize: "14px", fontWeight: 600 }}>Countries</div>
                {features.countryRestriction ? (
                  <CountryPicker value={allowedCountries} onChange={setAllowedCountries} />
                ) : (
                  <UpgradeNote feature="countryRestriction" />
                )}
              </s-stack>
            )}
          </s-stack>
        </s-section>

        <s-section>
          <CardTitle>Cart requirements</CardTitle>
          {features.maxCartItems ? (
            <s-number-field
              label="Maximum items in the cart (optional)"
              inputMode="numeric"
              value={maxCartItems}
              min={1}
              placeholder="No limit"
              details="Stops this code applying when the cart holds more than that many items in total, counting every product and quantity. Use 1 for single-item orders only."
              onInput={numericInputHandler("integer", setMaxCartItems)}
            />
          ) : (
            <UpgradeNote feature="maxCartItems" />
          )}
        </s-section>

        <s-section>
          <CardTitle>Maximum discount uses</CardTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", alignItems: "start" }}>
            <s-number-field
              label="Maximum total uses (optional)"
              inputMode="numeric"
              value={usageLimit}
              min={1}
              placeholder="Unlimited"
              details="Cap total redemptions across all customers."
              onInput={numericInputHandler("integer", setUsageLimit)}
            />
            {features.usesPerCustomer ? (
              <s-number-field
                label="Limit uses per customer (optional)"
                inputMode="numeric"
                value={usesPerCustomerLimit}
                min={1}
                placeholder="Unlimited"
                details="Cap how many times each customer can redeem this code."
                onInput={numericInputHandler("integer", setUsesPerCustomerLimit)}
              />
            ) : (
              <UpgradeNote feature="usesPerCustomer" />
            )}
          </div>
          {loaderData.usesPerCustomerLimit != null && (
            <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
              <s-text style={{ fontSize: "13px", color: "#6d7175" }}>
                {loaderData.usageCappedCount} customer{loaderData.usageCappedCount === 1 ? "" : "s"} currently at the limit
              </s-text>
              <s-button variant="tertiary" onClick={handleResetUsage} disabled={isSaving}>
                Reset usage counts
              </s-button>
            </div>
          )}
        </s-section>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "16px", justifyContent: "space-between" }}>
        <s-button variant="primary" disabled={isSaving} onClick={handleSave}>
          {isSaving ? "Saving..." : "Save changes"}
        </s-button>
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
