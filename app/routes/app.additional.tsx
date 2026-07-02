import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type DiscountSet = {
  numericId: string;
  title: string;
  status: string;
  usedCodes: number;
  totalCodes: number;
  startsAt: string;
  endsAt: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const sets: DiscountSet[] = [];
  let cursor: string | null = null;

  do {
    const res = await admin.graphql(
      `#graphql
      query GetDiscountSets($after: String) {
        discountNodes(first: 50, after: $after, query: "function_id:discount-rejection-function-js") {
          nodes {
            id
            discount {
              ... on DiscountCodeApp {
                title
                status
                startsAt
                endsAt
                asyncUsageCount
                codesCount { count }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { after: cursor } }
    );

    const data = await res.json();
    const nodes = data.data?.discountNodes?.nodes ?? [];

    for (const node of nodes) {
      const d = node.discount;
      if (!d?.title) continue;
      sets.push({
        numericId: node.id.split("/").pop(),
        title: d.title,
        status: d.status ?? "UNKNOWN",
        usedCodes: d.asyncUsageCount ?? 0,
        totalCodes: d.codesCount?.count ?? 0,
        startsAt: d.startsAt,
        endsAt: d.endsAt ?? null,
      });
    }

    const pageInfo = data.data?.discountNodes?.pageInfo;
    cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  sets.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  const totalCodes = sets.reduce((sum, s) => sum + s.totalCodes, 0);
  const totalUsed = sets.reduce((sum, s) => sum + s.usedCodes, 0);
  const activeSets = sets.filter((s) => s.status === "ACTIVE").length;

  return { sets, totalCodes, totalUsed, activeSets };
};

function formatDate(iso: string | null) {
  if (!iso) return "No expiration";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DiscountSets() {
  const { sets, totalCodes, totalUsed, activeSets } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const usageRate = totalCodes > 0 ? Math.round((totalUsed / totalCodes) * 100) : 0;

  return (
    <s-page heading="Discount Sets">
      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold" style={{ fontSize: "24px" }}>{sets.length}</s-text>
              <s-text>Total sets</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold" style={{ fontSize: "24px" }}>{activeSets}</s-text>
              <s-text>Active</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold" style={{ fontSize: "24px" }}>{totalCodes.toLocaleString()}</s-text>
              <s-text>Total codes</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold" style={{ fontSize: "24px" }}>{totalUsed.toLocaleString()}</s-text>
              <s-text>Codes used</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold" style={{ fontSize: "24px" }}>{usageRate}%</s-text>
              <s-text>Usage rate</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="All discount sets">
        {sets.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No discount sets created yet.</s-paragraph>
            <s-button onClick={() => navigate("/app")}>Create your first discount set</s-button>
          </s-stack>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px", gap: "12px", marginBottom: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 3 }}>Title</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", width: "80px" }}>Status</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 2 }}>Usage</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 2 }}>Expires</span>
              <span style={{ width: "60px" }}></span>
            </div>
            {sets.map((s: DiscountSet) => {
              const setUsageRate = s.totalCodes > 0 ? Math.round((s.usedCodes / s.totalCodes) * 100) : 0;
              return (
                <div key={s.numericId} style={{ display: "flex", alignItems: "center", padding: "12px 12px", borderBottom: "1px solid #e1e3e5", gap: "12px" }}>
                  <span style={{ flex: 3, fontSize: "14px" }}>{s.title}</span>
                  <div style={{ width: "80px" }}>
                    {s.status === "ACTIVE" ? (
                      <s-badge tone="success">Active</s-badge>
                    ) : s.status === "EXPIRED" ? (
                      <s-badge tone="critical">Expired</s-badge>
                    ) : (
                      <s-badge>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</s-badge>
                    )}
                  </div>
                  <span style={{ flex: 2, fontSize: "14px", color: "#6d7175" }}>{s.usedCodes} / {s.totalCodes} ({setUsageRate}%)</span>
                  <span style={{ flex: 2, fontSize: "14px", color: "#6d7175" }}>{formatDate(s.endsAt)}</span>
                  <div style={{ width: "60px" }}>
                    <s-button onClick={() => navigate(`/app/discounts/${s.numericId}`)}>View</s-button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </s-section>

      <s-stack direction="inline" gap="base">
        <s-button variant="primary" onClick={() => navigate("/app")}>
          Create new discount set
        </s-button>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
