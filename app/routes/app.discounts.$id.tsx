import { useCallback, useState, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

type RedeemCode = { code: string; usageCount: number };

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
    let totalCount = 0;

    do {
      const res = await admin.graphql(
        `#graphql
        query GetDiscountCodes($id: ID!, $after: String) {
          discountNode(id: $id) {
            discount {
              ... on DiscountCodeApp {
                title
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

    return { numericId, title, shop, codes: allCodes, totalCount, usedCount, preUsedCodes, error: null as string | null };
  } catch (err: unknown) {
    return {
      numericId: params.id,
      title: "Discount",
      shop: "",
      codes: [] as RedeemCode[],
      totalCount: 0,
      usedCount: 0,
      preUsedCodes: [] as string[],
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const code = formData.get("code") as string;
  const gid = `gid://shopify/DiscountCodeNode/${params.id}`;

  await admin.graphql(
    `#graphql
    mutation DisableCode($discountId: ID!, $search: String) {
      discountRedeemCodeBulkDelete(discountId: $discountId, search: $search) {
        userErrors { field message }
      }
    }`,
    { variables: { discountId: gid, search: code } }
  );

  return { ok: true };
};

export default function DiscountDetails() {
  const { title, numericId, shop, codes, totalCount, usedCount, preUsedCodes, error } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const unusedCount = Math.max(0, totalCount - usedCount - preUsedCodes.length);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);

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
    const rows = [
      "Code,Status",
      ...filtered.map((c: RedeemCode) => `${c.code},${c.usageCount > 0 ? "Used" : "Unused"}`),
      ...(unusedOnly ? [] : preUsedCodes.map((c: string) => `${c},Previously Used`)),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title ?? "discount-codes"}${unusedOnly ? "-unused" : "-all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [codes, preUsedCodes, title]);

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
