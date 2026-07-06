import { useState, useCallback, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

type ParsedCode = { code: string; used: boolean };

function parseCSVCodes(text: string): ParsedCode[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, "").toLowerCase());
  const codeIdx = headers.indexOf("code");
  if (codeIdx === -1) return [];
  const statusIdx = headers.indexOf("status");
  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(",");
      const code = cols[codeIdx]?.trim().replace(/^["']|["']$/g, "").toUpperCase() ?? "";
      const status = statusIdx >= 0 ? cols[statusIdx]?.trim().replace(/^["']|["']$/g, "").toLowerCase() : "";
      return code ? { code, used: status === "used" } : null;
    })
    .filter((c): c is ParsedCode => c !== null);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    const title = String(formData.get("title") || "Bulk Discount");
    const percentage = Number(formData.get("percentage") || 0);
    const codeMode = String(formData.get("codeMode") || "generate");
    const endsAtRaw = String(formData.get("endsAt") || "");
    const endsAt = endsAtRaw ? new Date(endsAtRaw).toISOString() : null;
    const usageLimitOne = formData.get("usageLimitOne") === "1";
    const oncePerCustomer = formData.get("oncePerCustomer") === "1";
    const combinesWithProduct = formData.get("combinesWithProduct") === "1";
    const combinesWithOrder = formData.get("combinesWithOrder") === "1";
    const combinesWithShipping = formData.get("combinesWithShipping") === "1";
    const productIds: string[] = JSON.parse(String(formData.get("productIds") || "[]"));
    const collectionIds: string[] = JSON.parse(String(formData.get("collectionIds") || "[]"));

    if (!percentage || percentage < 1 || percentage > 100) {
      return { error: "Percentage must be between 1 and 100." };
    }
    if (productIds.length === 0 && collectionIds.length === 0) {
      return { error: "Select at least one eligible product or collection." };
    }

    // Build the codes list
    let finalCodes: string[];

    let preUsedCodes: string[] = [];

    if (codeMode === "import") {
      const csvFile = formData.get("csvFile");
      if (!csvFile || typeof csvFile === "string") {
        return { error: "Please upload a CSV file." };
      }
      const text = await (csvFile as File).text();
      const parsed = parseCSVCodes(text);
      if (parsed.length === 0) {
        return { error: 'No codes found. Make sure the CSV has a column named "Code".' };
      }
      if (parsed.length > 5000) {
        return { error: "Maximum 5,000 codes per import." };
      }
      preUsedCodes = parsed.filter((c) => c.used).map((c) => c.code);
      finalCodes = parsed.filter((c) => !c.used).map((c) => c.code);
      if (finalCodes.length === 0) {
        return { error: "No unused codes found in the CSV — all codes are marked as Used." };
      }
    } else {
      const prefix = String(formData.get("prefix") || "")
        .toUpperCase()
        .replace(/[^A-Z0-9\-_]/g, "")
        .replace(/^[\-_]+|[\-_]+$/g, "");
      const codeCount = Math.min(Math.max(Number(formData.get("codeCount") || 100), 1), 5000);
      const codeLength = Math.min(Math.max(Number(formData.get("codeLength") || 6), 4), 12);

      if (!prefix) return { error: "Code prefix is required." };

      const randomSuffix = () => {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let s = "";
        for (let i = 0; i < codeLength; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
      };
      const codeSet = new Set<string>();
      while (codeSet.size < codeCount) codeSet.add(`${prefix}-${randomSuffix()}`);
      finalCodes = Array.from(codeSet);
    }

    // Expand collection IDs → product IDs
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

    if (resolvedProductIds.length === 0) {
      return { error: "No products found in the selected collections." };
    }

    // Step 1: create the discount — try each code until one isn't a duplicate
    let discountId: string | null = null;
    let firstCodeIndex = 0;
    for (let i = 0; i < finalCodes.length; i++) {
      const createRes = await admin.graphql(
        `#graphql
        mutation CreateBulkCodeDiscount($input: DiscountCodeAppInput!) {
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
              appliesOncePerCustomer: oncePerCustomer,
              ...(usageLimitOne ? { usageLimit: 1 } : {}),
              code: finalCodes[i],
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
      const isDuplicate = createErrors.some((e: { message: string }) => e.message.toLowerCase().includes("unique"));
      if (isDuplicate) continue;
      if (createErrors.length > 0) {
        return { error: `Creating discount: ${createErrors.map((e: { message: string }) => e.message).join(", ")}` };
      }
      discountId = createData.data?.discountCodeAppCreate?.codeAppDiscount?.discountId ?? null;
      firstCodeIndex = i;
      break;
    }
    if (!discountId) return { error: "Failed to create discount — all codes may already be in use in other discount sets." };
    const firstCode = finalCodes[firstCodeIndex];

    // Fetch this shop's blocked product types to bake into metafield
    const blockedRows = await db.blockedProductType.findMany({
      where: { shop: session.shop },
      select: { productType: true },
    });
    const blockedProductTypes = blockedRows.length > 0
      ? blockedRows.map((r: { productType: string }) => r.productType)
      : ["GWP"]; // default fallback

    // Step 2: save function configuration metafield
    const metafieldRes = await admin.graphql(
      `#graphql
      mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { key namespace value }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: discountId,
              namespace: "$app",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify({ productIds: resolvedProductIds, collectionIds, percentage, blockedProductTypes }),
            },
          ],
        },
      }
    );
    const metafieldData = await metafieldRes.json();
    const metafieldErrors = metafieldData.data?.metafieldsSet?.userErrors ?? [];
    if (metafieldErrors.length > 0) {
      return { error: `Saving configuration: ${metafieldErrors.map((e: { message: string }) => e.message).join(", ")}` };
    }

    // Step 3: bulk-add remaining codes in batches of 250 (skip the one used for creation)
    const remainingCodes = finalCodes
      .filter((_, i) => i !== firstCodeIndex)
      .map((code) => ({ code }));
    for (let i = 0; i < remainingCodes.length; i += 250) {
      const batch = remainingCodes.slice(i, i + 250);
      const bulkRes = await admin.graphql(
        `#graphql
        mutation AddBulkCodes($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
          discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
            bulkCreation { id codesCount }
            userErrors { field message }
          }
        }`,
        { variables: { discountId, codes: batch } }
      );

      const bulkData = await bulkRes.json();
      const bulkErrors = (bulkData.data?.discountRedeemCodeBulkAdd?.userErrors ?? [])
        .filter((e: { message: string }) => !e.message.toLowerCase().includes("unique"));
      if (bulkErrors.length > 0) {
        return {
          error: `Adding codes: ${bulkErrors.map((e: { message: string }) => e.message).join(", ")}`,
          discountId,
        };
      }
    }

    // Save historically used codes to DB so they show on the details page
    if (preUsedCodes.length > 0) {
      // Remove any stale records for these codes (from a previously deleted set)
      await db.preUsedCode.deleteMany({
        where: { shop: session.shop, code: { in: preUsedCodes } },
      });
      await db.preUsedCode.createMany({
        data: preUsedCodes.map((code) => ({
          shop: session.shop,
          discountId,
          code,
        })),
      });
    }

    return {
      discountId,
      title,
      percentage,
      codeCount: finalCodes.length,
      preUsedCount: preUsedCodes.length,
      firstCode,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Unexpected error: ${message}` };
  }
};

type SelectedItem = { id: string; title: string };

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("Bulk Discount");
  const [percentage, setPercentage] = useState("20");
  const [codeMode, setCodeMode] = useState<"generate" | "import">("generate");
  const [endsAt, setEndsAt] = useState("");
  const [usageLimitOne, setUsageLimitOne] = useState(true);
  const [oncePerCustomer, setOncePerCustomer] = useState(true);
  const [combinesWithProduct, setCombinesWithProduct] = useState(false);
  const [combinesWithOrder, setCombinesWithOrder] = useState(false);
  const [combinesWithShipping, setCombinesWithShipping] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [codeCount, setCodeCount] = useState("100");
  const [codeLength, setCodeLength] = useState("6");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<{ count: number; sample: string } | null>(null);
  const [selectionType, setSelectionType] = useState<"product" | "collection">("product");
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  const isLoading = fetcher.state !== "idle";
  const result = fetcher.data as Record<string, unknown> | undefined;
  const hasError = result && "error" in result;
  const hasSuccess = result && "discountId" in result && !hasError;

  const handlePickItems = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: selectionType,
      multiple: true,
      selectionIds: selectedItems.map((p) => ({ id: p.id })),
    });
    if (selected) {
      setSelectedItems(selected.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })));
    }
  }, [shopify, selectionType, selectedItems]);

  const handleSelectionTypeChange = useCallback((type: "product" | "collection") => {
    setSelectionType(type);
    setSelectedItems([]);
  }, []);

  const handleFileChange = useCallback(async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0] ?? null;
    setCsvFile(file);
    if (!file) { setCsvPreview(null); return; }
    const text = await file.text();
    const codes = parseCSVCodes(text);
    setCsvPreview(codes.length > 0 ? { count: codes.length, sample: codes[0]?.code ?? "" } : null);
    if (codes.length === 0) setCsvFile(null);
  }, []);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("title", title);
    formData.set("percentage", percentage);
    formData.set("codeMode", codeMode);
    formData.set("endsAt", endsAt);
    formData.set("usageLimitOne", usageLimitOne ? "1" : "0");
    formData.set("oncePerCustomer", oncePerCustomer ? "1" : "0");
    formData.set("combinesWithProduct", combinesWithProduct ? "1" : "0");
    formData.set("combinesWithOrder", combinesWithOrder ? "1" : "0");
    formData.set("combinesWithShipping", combinesWithShipping ? "1" : "0");
    if (codeMode === "import" && csvFile) {
      formData.set("csvFile", csvFile);
    } else {
      formData.set("prefix", prefix);
      formData.set("codeCount", codeCount);
      formData.set("codeLength", codeLength);
    }
    if (selectionType === "product") {
      formData.set("productIds", JSON.stringify(selectedItems.map((p) => p.id)));
      formData.set("collectionIds", JSON.stringify([]));
    } else {
      formData.set("collectionIds", JSON.stringify(selectedItems.map((p) => p.id)));
      formData.set("productIds", JSON.stringify([]));
    }
    fetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
  }, [fetcher, title, percentage, codeMode, csvFile, prefix, codeCount, codeLength, selectionType, selectedItems]);

  const handleReset = useCallback(() => {
    setTitle("Bulk Discount");
    setPercentage("20");
    setCodeMode("generate");
    setEndsAt("");
    setUsageLimitOne(true);
    setOncePerCustomer(true);
    setPrefix("");
    setCodeCount("100");
    setCodeLength("6");
    setCsvFile(null);
    setCsvPreview(null);
    setSelectedItems([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fetcher.load("/app");
  }, [fetcher]);

  const sanitizedPrefix = prefix.toUpperCase().replace(/[^A-Z0-9\-_]/g, "").replace(/^[\-_]+|[\-_]+$/g, "");
  const previewSuffix = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".slice(0, Number(codeLength) || 6);
  const previewCode = sanitizedPrefix ? `${sanitizedPrefix}-${previewSuffix}` : "";

  const canSubmit =
    !!percentage &&
    selectedItems.length > 0 &&
    (codeMode === "import" ? !!csvFile && !!csvPreview : !!prefix);

  return (
    <s-page heading="Create Bulk Discount Codes">
      {hasSuccess && (
        <s-banner title={`Discount created: ${result.title}`} tone="success" onDismiss={handleReset}>
          <s-paragraph>
            {result.codeCount} active codes queued • e.g. {result.firstCode as string} •{" "}
            {result.percentage}% off eligible products
          </s-paragraph>
          {(result.preUsedCount as number) > 0 && (
            <s-paragraph>
              {result.preUsedCount as number} previously used codes recorded for history.
            </s-paragraph>
          )}
          <s-paragraph>Discount ID: {result.discountId as string}</s-paragraph>
        </s-banner>
      )}

      {hasError && (
        <s-banner title="Something went wrong" tone="critical">
          <s-paragraph>{result.error as string}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Discount details">
        <s-form-layout>
          <s-text-field
            label="Title"
            value={title}
            onInput={(e: InputEvent) => setTitle((e.target as HTMLInputElement).value)}
            helpText="Shown in the Shopify admin discounts list"
          />
          <s-text-field
            label="Percentage off"
            type="number"
            value={percentage}
            min="1"
            max="100"
            suffix="%"
            onInput={(e: InputEvent) => setPercentage((e.target as HTMLInputElement).value)}
          />
          <s-stack direction="block" gap="none">
            <s-text emphasis="bold" style={{ fontSize: "14px" }}>Expiration date</s-text>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              style={{ marginTop: "4px", padding: "6px 8px", fontSize: "14px", borderRadius: "6px", border: "1px solid #ccc", width: "200px" }}
            />
            <s-text style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>Optional — leave blank for no expiration</s-text>
          </s-stack>
          <s-stack direction="block" gap="tight">
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={usageLimitOne}
                onChange={(e) => setUsageLimitOne(e.target.checked)}
              />
              Limit number of times each code can be used in total (1)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={oncePerCustomer}
                onChange={(e) => setOncePerCustomer(e.target.checked)}
              />
              Limit to one use per customer
            </label>
          </s-stack>
        </s-form-layout>
      </s-section>

      <s-section heading="Combinations">
        <s-stack direction="block" gap="tight">
          <s-paragraph>Choose whether this discount can be combined with other discount types.</s-paragraph>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input type="checkbox" checked={combinesWithProduct} onChange={(e) => setCombinesWithProduct(e.target.checked)} />
            Product discounts
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input type="checkbox" checked={combinesWithOrder} onChange={(e) => setCombinesWithOrder(e.target.checked)} />
            Order discounts
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input type="checkbox" checked={combinesWithShipping} onChange={(e) => setCombinesWithShipping(e.target.checked)} />
            Shipping discounts
          </label>
        </s-stack>
      </s-section>

      <s-section heading="Codes">
        <s-stack direction="block" gap="base">
          <div style={{ width: "fit-content" }}>
          <div style={{ display: "inline-flex", background: "#f1f1f1", borderRadius: "8px", padding: "3px", gap: "2px" }}>
            {(["generate", "import"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setCodeMode(mode)}
                style={{
                  padding: "6px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
                  fontSize: "14px", fontWeight: 500, transition: "all 0.15s",
                  background: codeMode === mode ? "#fff" : "transparent",
                  color: codeMode === mode ? "#202223" : "#6d7175",
                  boxShadow: codeMode === mode ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                }}
              >
                {mode === "generate" ? "Generate randomly" : "Import from CSV"}
              </button>
            ))}
          </div>
          </div>

          {codeMode === "generate" && (
            <s-form-layout>
              <s-text-field
                label="Code prefix"
                value={prefix}
                onInput={(e: InputEvent) => setPrefix((e.target as HTMLInputElement).value)}
                helpText={previewCode ? `Preview: ${previewCode}` : "Letters and numbers only, e.g. BAJIO"}
              />
              <s-text-field
                label="Number of codes"
                type="number"
                value={codeCount}
                min="1"
                max="5000"
                onInput={(e: InputEvent) => setCodeCount((e.target as HTMLInputElement).value)}
                helpText="Maximum 5,000 per batch"
              />
              <s-text-field
                label="Code length"
                type="number"
                value={codeLength}
                min="4"
                max="12"
                onInput={(e: InputEvent) => setCodeLength((e.target as HTMLInputElement).value)}
                helpText="Number of random characters after the prefix (4–12)"
              />
            </s-form-layout>
          )}

          {codeMode === "import" && (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Upload a CSV file with a <strong>Code</strong> column. Each row becomes one discount code.
              </s-paragraph>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange as unknown as React.ChangeEventHandler<HTMLInputElement>}
                style={{ fontSize: "14px" }}
              />
              {csvPreview && (
                <s-banner tone="success" title={`${csvPreview.count} codes detected`}>
                  <s-paragraph>First code: {csvPreview.sample}. Codes marked "Used" will be uploaded to Shopify and flagged as previously used in the app.</s-paragraph>
                </s-banner>
              )}
              {csvFile && !csvPreview && (
                <s-banner tone="critical" title='No "Code" column found'>
                  <s-paragraph>Make sure the CSV has a header row with a column named exactly "Code".</s-paragraph>
                </s-banner>
              )}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Eligible items">
        <s-paragraph>
          The discount applies to the highest-priced eligible item in the cart — 1 unit only.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <div style={{ width: "fit-content" }}>
          <div style={{ display: "inline-flex", background: "#f1f1f1", borderRadius: "8px", padding: "3px", gap: "2px" }}>
            {(["product", "collection"] as const).map((type) => (
              <button
                key={type}
                onClick={() => handleSelectionTypeChange(type)}
                style={{
                  padding: "6px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
                  fontSize: "14px", fontWeight: 500, transition: "all 0.15s",
                  background: selectionType === type ? "#fff" : "transparent",
                  color: selectionType === type ? "#202223" : "#6d7175",
                  boxShadow: selectionType === type ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                }}
              >
                {type === "product" ? "Products" : "Collections"}
              </button>
            ))}
          </div>
          </div>
          <s-button onClick={handlePickItems}>
            {selectedItems.length > 0
              ? `${selectedItems.length} ${selectionType}${selectedItems.length > 1 ? "s" : ""} selected — change`
              : `Select ${selectionType}s`}
          </s-button>
          {selectedItems.length > 0 && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="tight">
                {selectedItems.map((p) => (
                  <s-text key={p.id}>{p.title}</s-text>
                ))}
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-stack direction="inline" gap="base">
        <s-button
          variant="primary"
          onClick={handleSubmit}
          {...(isLoading ? { loading: true } : {})}
          disabled={!canSubmit}
        >
          Create discount codes
        </s-button>
        {hasSuccess && <s-button onClick={handleReset}>Create another</s-button>}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
