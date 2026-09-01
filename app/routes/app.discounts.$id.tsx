import { useCallback, useState, useMemo, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { checkCodeQuota } from "../billing.server";

type RedeemCode = { code: string; usageCount: number };
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const numericId = params.id;
    const gid = `gid://shopify/DiscountCodeNode/${numericId}`;
    const shop = session.shop;

    // Paginate through all codes (max 250 per page)
    const allCodes: RedeemCode[] = [];
    let cursor: string | null = null;
    let title = "Discount";
    let endsAt: string | null = null;
    let totalCount = 0;

    do {
      const res = await admin.graphql(
        `#graphql
        query GetDiscountCodes($id: ID!, $after: String) {
          discountNode(id: $id) {
            discount {
              ... on DiscountCodeApp {
                title
                endsAt
                codes(first: 250, after: $after) {
                  nodes { code asyncUsageCount }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          }
        }`,
        { variables: { id: gid, after: cursor } }
      );

      const data = await res.json();
      const discount = data.data?.discountNode?.discount;
      if (discount?.title) title = discount.title;
      if (discount?.endsAt !== undefined) endsAt = discount.endsAt;
      const codesPage = discount?.codes;
      for (const node of codesPage?.nodes ?? []) {
        allCodes.push({ code: node.code, usageCount: node.asyncUsageCount ?? 0 });
      }
      totalCount = allCodes.length;
      cursor = codesPage?.pageInfo?.hasNextPage ? codesPage.pageInfo.endCursor : null;

      // Cap at 2000 codes in the UI to keep response fast
      if (allCodes.length >= 2000) break;
    } while (cursor);

    const usedCount = allCodes.filter((c) => c.usageCount > 0).length;

    // Fetch historically used codes from DB
    const preUsedRows = await db.preUsedCode.findMany({
      where: { shop: session.shop, discountId: gid },
      select: { code: true },
      orderBy: { createdAt: "asc" },
    });
    const preUsedCodes = preUsedRows.map((r) => r.code);

    // Fetch known creation dates for codes we've tracked ourselves — Shopify's
    // API doesn't expose a createdAt on individual redeem codes, so codes with
    // no matching row here predate this tracking and are labeled "Original".
    const issuedRows = await db.issuedCode.findMany({
      where: { shop: session.shop, discountId: gid },
      select: { code: true, createdAt: true },
    });
    const codeDates: Record<string, string> = {};
    for (const row of issuedRows) {
      codeDates[row.code] = row.createdAt.toISOString().slice(0, 10);
    }

    // Infer the prefix/length used to generate existing codes (format is
    // always PREFIX-SUFFIX, and the random suffix never contains a hyphen),
    // so "Add more codes" can reuse it without asking the merchant again.
    let inferredPrefix: string | null = null;
    let inferredCodeLength: number | null = null;
    if (allCodes.length > 0) {
      const sample = allCodes[0].code;
      const idx = sample.lastIndexOf("-");
      if (idx > 0 && idx < sample.length - 1) {
        inferredPrefix = sample.slice(0, idx);
        inferredCodeLength = sample.length - idx - 1;
      }
    }

    // Fetch metafield config to show eligible products
    const metafieldRes = await admin.graphql(
      `#graphql
      query GetDiscountConfig($id: ID!) {
        discountNode(id: $id) {
          metafield(namespace: "$app", key: "function-configuration") { value }
        }
      }`,
      { variables: { id: gid } }
    );
    const metafieldData = await metafieldRes.json();
    const rawConfig = metafieldData.data?.discountNode?.metafield?.value ?? null;
    let eligibleProductIds: string[] = [];
    let eligibleCollectionIds: string[] = [];
    let percentage: number | null = null;
    let fixedAmount: number | null = null;
    let discountType: "percentage" | "fixedAmount" = "percentage";
    try {
      if (rawConfig) {
        const cfg = JSON.parse(rawConfig);
        eligibleProductIds = cfg.productIds ?? [];
        eligibleCollectionIds = cfg.collectionIds ?? [];
        percentage = cfg.percentage ?? null;
        fixedAmount = cfg.fixedAmount ?? null;
        discountType = cfg.discountType === "fixedAmount" ? "fixedAmount" : "percentage";
      }
    } catch { /* ignore */ }

    // Prefer showing collections if they were used; fall back to products
    let eligibleProducts: { id: string; title: string }[] = [];
    let eligibleCollections: { id: string; title: string }[] = [];

    if (eligibleCollectionIds.length > 0) {
      const colTitlesRes = await admin.graphql(
        `#graphql
        query CollectionTitles($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Collection { id title } }
        }`,
        { variables: { ids: eligibleCollectionIds.slice(0, 50) } }
      );
      const colTitlesData = await colTitlesRes.json();
      eligibleCollections = (colTitlesData.data?.nodes ?? [])
        .filter((n: { id?: string; title?: string } | null) => n?.id)
        .map((n: { id: string; title: string }) => ({ id: n.id, title: n.title }));
    } else if (eligibleProductIds.length > 0) {
      const titlesRes = await admin.graphql(
        `#graphql
        query ProductTitles($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id title } }
        }`,
        { variables: { ids: eligibleProductIds.slice(0, 50) } }
      );
      const titlesData = await titlesRes.json();
      eligibleProducts = (titlesData.data?.nodes ?? [])
        .filter((n: { id?: string; title?: string } | null) => n?.id)
        .map((n: { id: string; title: string }) => ({ id: n.id, title: n.title }));
    }

    return { numericId, title, shop, codes: allCodes, totalCount, usedCount, preUsedCodes, codeDates, inferredPrefix, inferredCodeLength, eligibleProducts, eligibleProductIds, eligibleCollections, eligibleCollectionIds, discountType, percentage, fixedAmount, endsAt, error: null as string | null };
  } catch (err: unknown) {
    return {
      numericId: params.id,
      title: "Discount",
      shop: "",
      codes: [] as RedeemCode[],
      totalCount: 0,
      usedCount: 0,
      preUsedCodes: [] as string[],
      codeDates: {} as Record<string, string>,
      inferredPrefix: null as string | null,
      inferredCodeLength: null as number | null,
      eligibleProducts: [] as { id: string; title: string }[],
      eligibleProductIds: [] as string[],
      eligibleCollections: [] as { id: string; title: string }[],
      eligibleCollectionIds: [] as string[],
      discountType: "percentage" as "percentage" | "fixedAmount",
      endsAt: null as string | null,
      percentage: null as number | null,
      fixedAmount: null as number | null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const gid = `gid://shopify/DiscountCodeNode/${params.id}`;

  if (intent === "addCodes") {
    const codeMode = String(formData.get("codeMode") || "generate");
    let finalCodes: string[] = [];
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
      if (finalCodes.length === 0 && preUsedCodes.length === 0) {
        return { error: "No codes found in the CSV." };
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

    if (finalCodes.length > 0) {
      const quota = await checkCodeQuota(admin, billing, finalCodes.length);
      if (!quota.allowed) {
        return {
          error: `Your ${quota.tier} plan allows up to ${quota.limit} active discount codes (currently using ${quota.current}). Upgrade on the Plans page to create more.`,
        };
      }
    }

    if (preUsedCodes.length > 0) {
      await db.preUsedCode.createMany({
        data: preUsedCodes.map((code) => ({ shop: session.shop, discountId: gid, code })),
        skipDuplicates: true,
      });
    }

    let addedCount = 0;
    const codesToAdd = finalCodes.map((code) => ({ code }));
    for (let i = 0; i < codesToAdd.length; i += 250) {
      const batch = codesToAdd.slice(i, i + 250);
      const bulkRes = await admin.graphql(
        `#graphql
        mutation AddBulkCodes($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
          discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
            bulkCreation { id codesCount }
            userErrors { field message }
          }
        }`,
        { variables: { discountId: gid, codes: batch } }
      );
      const bulkData = await bulkRes.json();
      const bulkErrors = (bulkData.data?.discountRedeemCodeBulkAdd?.userErrors ?? [])
        .filter((e: { message: string }) => !e.message.toLowerCase().includes("unique"));
      if (bulkErrors.length > 0) {
        return { error: `Adding codes: ${bulkErrors.map((e: { message: string }) => e.message).join(", ")}` };
      }
      addedCount += batch.length;
    }

    if (finalCodes.length > 0) {
      await db.issuedCode.createMany({
        data: finalCodes.map((code) => ({ shop: session.shop, discountId: gid, code })),
        skipDuplicates: true,
      });
    }

    return { addedCodes: true, addedCount, skippedCount: preUsedCodes.length };
  }

  if (intent === "updateEndsAt") {
    const endsAtRaw = String(formData.get("endsAt") || "");
    const endsAt = endsAtRaw ? new Date(`${endsAtRaw}T23:59:59.000Z`).toISOString() : null;
    const appDiscountId = gid.replace("DiscountCodeNode", "DiscountCodeApp");

    const res = await admin.graphql(
      `#graphql
      mutation UpdateDiscountEndsAt($id: ID!, $input: DiscountCodeAppInput!) {
        discountCodeAppUpdate(id: $id, codeAppDiscount: $input) {
          userErrors { field message }
        }
      }`,
      { variables: { id: appDiscountId, input: { endsAt } } }
    );
    const data = await res.json();
    const errors = data.data?.discountCodeAppUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      return { error: `Updating expiration: ${errors.map((e: { message: string }) => e.message).join(", ")}` };
    }

    return { endsAtUpdated: true };
  }

  if (intent === "updateItems") {
    const productIds: string[] = JSON.parse(formData.get("productIds") as string ?? "[]");
    const collectionIds: string[] = JSON.parse(formData.get("collectionIds") as string ?? "[]");
    const percentage = Number(formData.get("percentage") ?? 0);

    // Expand collections to product IDs
    let resolvedProductIds = [...productIds];
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

    if (resolvedProductIds.length === 0) return { error: "No products found." };

    // Read existing metafield to preserve other config (blockedProductTypes etc.)
    const existing = await admin.graphql(
      `#graphql
      query GetMeta($id: ID!) {
        discountNode(id: $id) {
          metafield(namespace: "$app", key: "function-configuration") { value }
        }
      }`,
      { variables: { id: gid } }
    );
    const existingData = await existing.json();
    let existingConfig: Record<string, unknown> = {};
    try {
      const raw = existingData.data?.discountNode?.metafield?.value;
      if (raw) existingConfig = JSON.parse(raw);
    } catch { /* empty */ }

    // Only overwrite percentage if this discount actually uses it — a fixed-amount
    // discount has no percentage field in its form, so don't stomp its config.
    const newConfig =
      existingConfig.discountType === "fixedAmount"
        ? { ...existingConfig, productIds: resolvedProductIds, collectionIds }
        : { ...existingConfig, productIds: resolvedProductIds, collectionIds, percentage };

    await admin.graphql(
      `#graphql
      mutation UpdateConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [{
            ownerId: gid,
            namespace: "$app",
            key: "function-configuration",
            type: "json",
            value: JSON.stringify(newConfig),
          }],
        },
      }
    );

    return { updated: true };
  }

  const code = formData.get("code") as string;

  // discountRedeemCodeBulkDelete is async — poll until the job completes
  const deleteRes = await admin.graphql(
    `#graphql
    mutation DisableCode($discountId: ID!, $search: String) {
      discountRedeemCodeBulkDelete(discountId: $discountId, search: $search) {
        job { id }
        userErrors { field message }
      }
    }`,
    { variables: { discountId: gid, search: code } }
  );
  const deleteData = await deleteRes.json();
  const jobId = deleteData.data?.discountRedeemCodeBulkDelete?.job?.id;

  if (jobId) {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const jobRes = await admin.graphql(
        `#graphql
        query JobStatus($id: ID!) {
          job(id: $id) { done }
        }`,
        { variables: { id: jobId } }
      );
      const jobData = await jobRes.json();
      if (jobData.data?.job?.done) break;
    }
  }

  return { ok: true };
};

export default function DiscountDetails() {
  const { title, numericId, shop, codes, totalCount, usedCount, preUsedCodes, codeDates, inferredPrefix, inferredCodeLength, eligibleProducts, eligibleProductIds, eligibleCollections, eligibleCollectionIds, discountType, percentage, fixedAmount, endsAt, error } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const unusedCount = Math.max(0, totalCount - usedCount - preUsedCodes.length);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const [editingItems, setEditingItems] = useState(false);

  const [endsAtInput, setEndsAtInput] = useState(endsAt ? new Date(endsAt).toISOString().split("T")[0] : "");

  const handleUpdateEndsAt = useCallback(() => {
    const form = new FormData();
    form.append("intent", "updateEndsAt");
    form.append("endsAt", endsAtInput);
    fetcher.submit(form, { method: "post" });
  }, [fetcher, endsAtInput]);

  const [addCodeMode, setAddCodeMode] = useState<"generate" | "import">("generate");
  const [addPrefix, setAddPrefix] = useState(inferredPrefix ?? "");
  const [addCodeCount, setAddCodeCount] = useState("100");
  const [addCodeLength, setAddCodeLength] = useState(String(inferredCodeLength ?? 6));
  const [addCsvFile, setAddCsvFile] = useState<File | null>(null);
  const [addCsvPreview, setAddCsvPreview] = useState<{ count: number; sample: string } | null>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const handleAddFileChange = useCallback(async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0] ?? null;
    setAddCsvFile(file);
    if (!file) { setAddCsvPreview(null); return; }
    const text = await file.text();
    const codes = parseCSVCodes(text);
    setAddCsvPreview(codes.length > 0 ? { count: codes.length, sample: codes[0]?.code ?? "" } : null);
    if (codes.length === 0) setAddCsvFile(null);
  }, []);

  const handleAddCodes = useCallback(() => {
    const form = new FormData();
    form.append("intent", "addCodes");
    form.append("codeMode", addCodeMode);
    if (addCodeMode === "import" && addCsvFile) {
      form.append("csvFile", addCsvFile);
    } else {
      form.append("prefix", addPrefix);
      form.append("codeCount", addCodeCount);
      form.append("codeLength", addCodeLength);
    }
    fetcher.submit(form, { method: "post", encType: "multipart/form-data" });
    setAddCsvFile(null);
    setAddCsvPreview(null);
    if (addFileInputRef.current) addFileInputRef.current.value = "";
  }, [fetcher, addCodeMode, addPrefix, addCodeCount, addCodeLength, addCsvFile]);

  const canAddCodes = addCodeMode === "import" ? !!addCsvFile && !!addCsvPreview : !!addPrefix.trim();

  const handleEditItems = useCallback(async (mode: "product" | "collection") => {
    setEditingItems(true);
    try {
      const selected = await shopify.resourcePicker({
        type: mode,
        multiple: true,
        selectionIds: mode === "product"
          ? eligibleProductIds.map((id) => ({ id }))
          : eligibleCollectionIds.map((id) => ({ id })),
      });
      if (!selected) return;
      const form = new FormData();
      form.append("intent", "updateItems");
      form.append("productIds", JSON.stringify(mode === "product" ? selected.map((p: { id: string }) => p.id) : []));
      form.append("collectionIds", JSON.stringify(mode === "collection" ? selected.map((c: { id: string }) => c.id) : []));
      form.append("percentage", String(percentage ?? 0));
      fetcher.submit(form, { method: "post" });
    } finally {
      setEditingItems(false);
    }
  }, [shopify, eligibleProductIds, percentage, fetcher]);

  const PAGE_SIZE = 50;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [preUsedPage, setPreUsedPage] = useState(0);
  const preUsedTotalPages = Math.max(1, Math.ceil(preUsedCodes.length / PAGE_SIZE));
  const safePreUsedPage = Math.min(preUsedPage, preUsedTotalPages - 1);
  const pagedPreUsedCodes = preUsedCodes.slice(safePreUsedPage * PAGE_SIZE, safePreUsedPage * PAGE_SIZE + PAGE_SIZE);

  const filteredCodes = useMemo(() => {
    const q = search.trim().toUpperCase();
    return q ? codes.filter((c: RedeemCode) => c.code.includes(q)) : codes;
  }, [codes, search]);

  const totalPages = Math.max(1, Math.ceil(filteredCodes.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedCodes = filteredCodes.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const handleExport = useCallback((unusedOnly = false) => {
    const filtered = unusedOnly ? codes.filter((c: RedeemCode) => c.usageCount === 0) : codes;
    const createdLabel = (code: string) => codeDates[code] ?? "Original";
    const rows = [
      "Code,Status,Created",
      ...filtered.map((c: RedeemCode) => `${c.code},${c.usageCount > 0 ? "Used" : "Unused"},${createdLabel(c.code)}`),
      ...(unusedOnly ? [] : preUsedCodes.map((c: string) => `${c},Previously Used,${createdLabel(c)}`)),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title ?? "discount-codes"}${unusedOnly ? "-unused" : "-all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [codes, preUsedCodes, codeDates, title]);

  return (
    <s-page heading={title ?? "Discount"}>
      {error && (
        <s-banner title="Error" tone="critical">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <div style={{ marginBottom: "20px" }}>
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" onClick={() => handleExport(false)} disabled={codes.length === 0 && preUsedCodes.length === 0}>
            Export all (CSV)
          </s-button>
          <s-button onClick={() => handleExport(true)} disabled={unusedCount === 0}>
            Export unused only
          </s-button>
          <s-button onClick={() => window.open(`https://${shop}/admin/discounts/${numericId}`, "_blank")}>
            View in Shopify admin
          </s-button>
          <s-button onClick={() => navigate("/app")}>Create another discount</s-button>
        </s-stack>
      </div>

      <s-section heading="Summary">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold">{totalCount}</s-text>
              <s-text>Total codes</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold">{usedCount}</s-text>
              <s-text>Used</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold">{unusedCount}</s-text>
              <s-text>Remaining</s-text>
            </s-stack>
          </s-box>
          {preUsedCodes.length > 0 && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="none">
                <s-text emphasis="bold">{preUsedCodes.length}</s-text>
                <s-text>Previously used</s-text>
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Expiration date">
        <s-stack direction="block" gap="base">
          {(fetcher.data as { endsAtUpdated?: boolean })?.endsAtUpdated && (
            <s-banner tone="success">
              <s-paragraph>Expiration date updated.</s-paragraph>
            </s-banner>
          )}
          <s-paragraph>
            {endsAt
              ? `Currently expires ${new Date(endsAt).toLocaleDateString("en-US", { timeZone: "UTC" })}.`
              : "No expiration date set."}
          </s-paragraph>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="date"
              value={endsAtInput}
              onChange={(e) => setEndsAtInput(e.target.value)}
              style={{ padding: "6px 8px", fontSize: "14px", borderRadius: "6px", border: "1px solid #ccc", width: "200px" }}
            />
            {endsAtInput && (
              <button
                onClick={() => setEndsAtInput("")}
                style={{ background: "none", border: "none", color: "#6d7175", fontSize: "12px", cursor: "pointer", padding: 0 }}
              >
                Clear
              </button>
            )}
          </div>
          <div>
            <s-button variant="primary" onClick={handleUpdateEndsAt} disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Saving…" : "Update expiration"}
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Eligible items">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            The discount applies to the highest-priced eligible item in the cart — 1 unit only.
            {discountType === "fixedAmount"
              ? fixedAmount !== null && <> (${fixedAmount} off)</>
              : percentage !== null && <> ({percentage}% off)</>}
          </s-paragraph>

          {(fetcher.data as { updated?: boolean })?.updated && (
            <s-banner tone="success">
              <s-paragraph>Eligible items updated successfully.</s-paragraph>
            </s-banner>
          )}
          {(fetcher.data as { error?: string })?.error && (
            <s-banner tone="critical">
              <s-paragraph>{(fetcher.data as { error: string }).error}</s-paragraph>
            </s-banner>
          )}

          {eligibleCollections.length > 0 ? (
            <>
              <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 1 }}>Collection</span>
              </div>
              {eligibleCollections.map((c: { id: string; title: string }) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", padding: "12px", borderBottom: "1px solid #e1e3e5" }}>
                  <span style={{ fontSize: "14px", flex: 1 }}>{c.title}</span>
                </div>
              ))}
              {eligibleCollectionIds.length > 50 && (
                <div style={{ padding: "8px 12px", fontSize: "13px", color: "#6d7175" }}>
                  Showing 50 of {eligibleCollectionIds.length} collections.
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 1 }}>Product</span>
              </div>
              {eligibleProducts.length === 0 && (
                <div style={{ padding: "12px", color: "#6d7175", fontSize: "14px" }}>
                  No eligible products configured.
                </div>
              )}
              {eligibleProducts.map((p: { id: string; title: string }) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", padding: "12px", borderBottom: "1px solid #e1e3e5" }}>
                  <span style={{ fontSize: "14px", flex: 1 }}>{p.title}</span>
                </div>
              ))}
              {eligibleProductIds.length > 50 && (
                <div style={{ padding: "8px 12px", fontSize: "13px", color: "#6d7175" }}>
                  Showing 50 of {eligibleProductIds.length} eligible products.
                </div>
              )}
            </>
          )}

          <s-stack direction="inline" gap="base">
            <s-button onClick={() => handleEditItems("product")} disabled={editingItems}>
              {editingItems ? "Opening picker…" : "Edit by products"}
            </s-button>
            <s-button onClick={() => handleEditItems("collection")} disabled={editingItems}>
              Edit by collection
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Add more codes">
        <s-stack direction="block" gap="base">
          {(fetcher.data as { addedCodes?: boolean })?.addedCodes && (
            <s-banner tone="success">
              <s-paragraph>
                Added {(fetcher.data as { addedCount: number }).addedCount} code
                {(fetcher.data as { addedCount: number }).addedCount !== 1 ? "s" : ""} to this discount.
                {(fetcher.data as { skippedCount: number }).skippedCount > 0 &&
                  ` ${(fetcher.data as { skippedCount: number }).skippedCount} previously-used code(s) were recorded but not added as active.`}
                {" "}Shopify may take a few seconds to process them.
              </s-paragraph>
            </s-banner>
          )}
          {(fetcher.data as { error?: string })?.error && (
            <s-banner tone="critical">
              <s-paragraph>{(fetcher.data as { error: string }).error}</s-paragraph>
            </s-banner>
          )}

          <div style={{ width: "fit-content" }}>
            <div style={{ display: "inline-flex", background: "#f1f1f1", borderRadius: "8px", padding: "3px", gap: "2px" }}>
              {(["generate", "import"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setAddCodeMode(mode)}
                  style={{
                    padding: "6px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
                    fontSize: "14px", fontWeight: 500, transition: "all 0.15s",
                    background: addCodeMode === mode ? "#fff" : "transparent",
                    color: addCodeMode === mode ? "#202223" : "#6d7175",
                    boxShadow: addCodeMode === mode ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                  }}
                >
                  {mode === "generate" ? "Generate randomly" : "Import from CSV"}
                </button>
              ))}
            </div>
          </div>

          {addCodeMode === "generate" && inferredPrefix && (
            <s-form-layout>
              <s-paragraph>
                New codes will reuse this set's existing prefix and format:{" "}
                <strong>{inferredPrefix}-{"X".repeat(inferredCodeLength ?? 6)}</strong>
              </s-paragraph>
              <s-text-field
                label="Number of codes"
                type="number"
                value={addCodeCount}
                min="1"
                max="5000"
                onInput={(e: InputEvent) => setAddCodeCount((e.target as HTMLInputElement).value)}
                helpText="Maximum 5,000 per batch"
              />
            </s-form-layout>
          )}

          {addCodeMode === "generate" && !inferredPrefix && (
            <s-form-layout>
              <s-paragraph>
                Couldn't detect a consistent prefix from this set's existing codes — enter one to use for new codes.
              </s-paragraph>
              <s-text-field
                label="Code prefix"
                value={addPrefix}
                onInput={(e: InputEvent) => setAddPrefix((e.target as HTMLInputElement).value)}
                helpText="Letters and numbers only, e.g. BAJIO"
              />
              <s-text-field
                label="Number of codes"
                type="number"
                value={addCodeCount}
                min="1"
                max="5000"
                onInput={(e: InputEvent) => setAddCodeCount((e.target as HTMLInputElement).value)}
                helpText="Maximum 5,000 per batch"
              />
              <s-text-field
                label="Code length"
                type="number"
                value={addCodeLength}
                min="4"
                max="12"
                onInput={(e: InputEvent) => setAddCodeLength((e.target as HTMLInputElement).value)}
                helpText="Number of random characters after the prefix (4–12)"
              />
            </s-form-layout>
          )}

          {addCodeMode === "import" && (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Upload a CSV file with a <strong>Code</strong> column. Each row becomes one discount code.
              </s-paragraph>
              <input
                ref={addFileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleAddFileChange as unknown as React.ChangeEventHandler<HTMLInputElement>}
                style={{ fontSize: "14px" }}
              />
              {addCsvPreview && (
                <s-banner tone="success" title={`${addCsvPreview.count} codes detected`}>
                  <s-paragraph>First code: {addCsvPreview.sample}. Codes marked "Used" will be uploaded to Shopify and flagged as previously used in the app.</s-paragraph>
                </s-banner>
              )}
              {addCsvFile && !addCsvPreview && (
                <s-banner tone="critical" title='No "Code" column found'>
                  <s-paragraph>Make sure the CSV has a header row with a column named exactly "Code".</s-paragraph>
                </s-banner>
              )}
            </s-stack>
          )}

          <div>
            <s-button variant="primary" onClick={handleAddCodes} disabled={!canAddCodes || fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Adding…" : "Add codes"}
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading={`Codes${totalCount >= 2000 ? " (first 2,000)" : ""}`}>
        <s-stack direction="block" gap="base">
          {/* Search */}
          <input
            type="search"
            placeholder="Search codes…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            style={{ padding: "8px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
          />

          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px", gap: "12px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 1 }}>Code</span>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", width: "90px", textAlign: "center" }}>Status</span>
            <span style={{ width: "68px" }}></span>
          </div>

          {pagedCodes.map((c: RedeemCode) => (
            <div key={c.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 12px", borderBottom: "1px solid #e1e3e5", gap: "12px" }}>
              <span style={{ fontFamily: "monospace", fontSize: "14px", fontWeight: 500, letterSpacing: "0.02em", flex: 1 }}>{c.code}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "90px", display: "flex", justifyContent: "center" }}>
                  {c.usageCount > 0 ? (
                    <s-badge tone="success">Used</s-badge>
                  ) : (
                    <s-badge>Unused</s-badge>
                  )}
                </div>
                {confirmCode === c.code ? (
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span style={{ fontSize: "13px", color: "#d72c0d" }}>Delete permanently?</span>
                    <fetcher.Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="code" value={c.code} />
                      <button
                        type="submit"
                        onClick={() => setConfirmCode(null)}
                        style={{ padding: "4px 10px", fontSize: "12px", background: "#d72c0d", color: "#fff", border: "none", borderRadius: "5px", cursor: "pointer" }}
                      >
                        Yes, delete
                      </button>
                    </fetcher.Form>
                    <button
                      onClick={() => setConfirmCode(null)}
                      style={{ padding: "4px 10px", fontSize: "12px", background: "transparent", border: "1px solid #ccc", borderRadius: "5px", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={c.usageCount > 0}
                    onClick={() => setConfirmCode(c.code)}
                    style={{
                      padding: "4px 10px", fontSize: "12px", background: "transparent",
                      border: "1px solid #ccc", borderRadius: "5px", cursor: c.usageCount > 0 ? "not-allowed" : "pointer",
                      color: c.usageCount > 0 ? "#aaa" : "#d72c0d",
                      borderColor: c.usageCount > 0 ? "#e1e3e5" : "#f5c6c2",
                    }}
                  >
                    Disable
                  </button>
                )}
              </div>
            </div>
          ))}

          {codes.length === 0 && (
            <s-paragraph>No codes found. Bulk codes may still be processing — refresh in a few seconds.</s-paragraph>
          )}
          {filteredCodes.length === 0 && codes.length > 0 && (
            <s-paragraph>No codes match your search.</s-paragraph>
          )}

          {/* Pagination */}
          {filteredCodes.length > 0 && (
            <s-stack direction="inline" gap="base" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <s-button
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Previous
              </s-button>
              <s-text style={{ fontSize: "13px", color: "#6d7175" }}>
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredCodes.length)} of {filteredCodes.length}
              </s-text>
              <s-button
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                Next →
              </s-button>
            </s-stack>
          )}

          {codes.length > 0 && !search && (
            <s-paragraph style={{ color: "#6d7175", fontSize: "13px" }}>
              Not seeing all codes? Shopify processes bulk uploads in the background — refresh in 30–60 seconds if the count looks low.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      {preUsedCodes.length > 0 && (
        <s-section heading="Previously used codes (historical)">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              These codes were imported as already used and are not active in Shopify.
            </s-paragraph>

            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px", gap: "12px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 1 }}>Code</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", width: "120px", textAlign: "center" }}>Status</span>
            </div>

            {pagedPreUsedCodes.map((c: string) => (
              <div key={c} style={{ display: "flex", alignItems: "center", padding: "12px 12px", borderBottom: "1px solid #e1e3e5", gap: "12px" }}>
                <span style={{ fontFamily: "monospace", fontSize: "14px", fontWeight: 500, letterSpacing: "0.02em", flex: 1 }}>{c}</span>
                <div style={{ width: "120px", display: "flex", justifyContent: "center" }}>
                  <s-badge tone="critical">Previously Used</s-badge>
                </div>
              </div>
            ))}

            {preUsedCodes.length > PAGE_SIZE && (
              <s-stack direction="inline" gap="base" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <s-button
                  disabled={safePreUsedPage === 0}
                  onClick={() => setPreUsedPage((p) => Math.max(0, p - 1))}
                >
                  ← Previous
                </s-button>
                <s-text style={{ fontSize: "13px", color: "#6d7175" }}>
                  {safePreUsedPage * PAGE_SIZE + 1}–{Math.min((safePreUsedPage + 1) * PAGE_SIZE, preUsedCodes.length)} of {preUsedCodes.length}
                </s-text>
                <s-button
                  disabled={safePreUsedPage >= preUsedTotalPages - 1}
                  onClick={() => setPreUsedPage((p) => Math.min(preUsedTotalPages - 1, p + 1))}
                >
                  Next →
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
