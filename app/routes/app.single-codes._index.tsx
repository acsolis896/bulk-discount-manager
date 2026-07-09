import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);

    const rows = await db.singleCodeDiscount.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return { codes: [], dbError: null };

    // Fetch status/usage from Shopify using discountNode (nodes() doesn't expose discount field)
    const nodeMap: Record<string, { title: string; status: string; usageCount: number }> = {};
    await Promise.all(
      rows.map(async (r) => {
        try {
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
                  }
                }
              }
            }`,
            { variables: { id: r.discountId } }
          );
          const data = await res.json();
          const node = data.data?.discountNode;
          if (node?.id) {
            nodeMap[node.id] = {
              title: node.discount?.title ?? "",
              status: node.discount?.status ?? "UNKNOWN",
              usageCount: node.discount?.asyncUsageCount ?? 0,
            };
          }
        } catch { /* skip on error — show defaults */ }
      })
    );

    const codes = rows.map((r) => ({
      id: r.id,
      discountId: r.discountId,
      numericId: r.discountId.split("/").pop(),
      code: r.code,
      requiredTag: r.requiredTag,
      blockedTag: r.blockedTag,
      title: nodeMap[r.discountId]?.title ?? r.code,
      status: nodeMap[r.discountId]?.status ?? "UNKNOWN",
      usageCount: nodeMap[r.discountId]?.usageCount ?? 0,
    }));

    return { codes, dbError: null };
  } catch (err: unknown) {
    return { codes: [], dbError: err instanceof Error ? err.message : String(err) };
  }
};

export default function SingleCodesPage() {
  const { codes, dbError } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Single Codes">
      {dbError && (
        <s-banner tone="critical" style={{ marginBottom: "16px" }}>
          <s-paragraph>Database error: {dbError}. The table may not have been created yet — try redeploying the app.</s-paragraph>
        </s-banner>
      )}
      <div style={{ marginBottom: "20px" }}>
        <s-button variant="primary" onClick={() => navigate("/app/single-codes/new")}>
          Create single code
        </s-button>
      </div>

      {codes.length === 0 ? (
        <s-section heading="">
          <s-paragraph>No single codes created yet.</s-paragraph>
        </s-section>
      ) : (
        <s-section heading="All single codes">
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px", gap: "12px", marginBottom: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 2 }}>Code</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", width: "80px" }}>Status</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 2 }}>Required tag</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 2 }}>Blocked tag</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", width: "80px" }}>Uses</span>
              <span style={{ width: "60px" }}></span>
            </div>
            {codes.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", padding: "12px", borderBottom: "1px solid #e1e3e5", gap: "12px" }}>
                <span style={{ fontFamily: "monospace", fontSize: "14px", fontWeight: 500, flex: 2 }}>{c.code}</span>
                <div style={{ width: "80px" }}>
                  {c.status === "ACTIVE" ? (
                    <s-badge tone="success">Active</s-badge>
                  ) : c.status === "EXPIRED" ? (
                    <s-badge tone="critical">Expired</s-badge>
                  ) : (
                    <s-badge>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</s-badge>
                  )}
                </div>
                <span style={{ fontSize: "13px", color: "#6d7175", flex: 2, fontFamily: "monospace" }}>{c.requiredTag}</span>
                <span style={{ fontSize: "13px", color: "#6d7175", flex: 2, fontFamily: "monospace" }}>{c.blockedTag}</span>
                <span style={{ fontSize: "14px", width: "80px" }}>{c.usageCount}</span>
                <div style={{ width: "60px" }}>
                  <s-button onClick={() => navigate(`/app/single-codes/${c.numericId}`)}>View</s-button>
                </div>
              </div>
            ))}
          </div>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
