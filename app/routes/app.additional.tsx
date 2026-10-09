import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { CardTitle } from "../components/CardTitle";
import { FormStyles } from "../components/FormStyles";

type DiscountSet = {
  numericId: string;
  title: string;
  status: string;
  usedCodes: number;
  totalCodes: number;
  startsAt: string;
  endsAt: string | null;
  isReusableCode: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Reusable codes have no usage cap, unlike bulk sets where totalCodes is a
  // real ceiling — flag them so the UI can show "Unlimited" instead of a
  // misleading X/1 fraction, without hiding them from this list.
  const reusableCodeRows = await db.singleCodeDiscount.findMany({
    where: { shop: session.shop },
    select: { discountId: true },
  });
  const reusableCodeIds = new Set(reusableCodeRows.map((r: { discountId: string }) => r.discountId.split("/").pop()));

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
      const numericId = node.id.split("/").pop();
      sets.push({
        numericId,
        title: d.title,
        status: d.status ?? "UNKNOWN",
        usedCodes: d.asyncUsageCount ?? 0,
        totalCodes: d.codesCount?.count ?? 0,
        startsAt: d.startsAt,
        endsAt: d.endsAt ?? null,
        isReusableCode: reusableCodeIds.has(numericId),
      });
    }

    const pageInfo = data.data?.discountNodes?.pageInfo;
    cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  sets.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  // Reusable codes have no usage cap, so they'd skew the aggregate usage
  // rate below — only count bulk sets toward it.
  const bulkSets = sets.filter((s) => !s.isReusableCode);
  const totalCodes = bulkSets.reduce((sum, s) => sum + s.totalCodes, 0);
  const totalUsed = bulkSets.reduce((sum, s) => sum + s.usedCodes, 0);
  const activeSets = sets.filter((s) => s.status === "ACTIVE").length;

  return { sets, totalCodes, totalUsed, activeSets };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const numericId = String(formData.get("numericId") || "");
  if (!numericId) return { error: "Missing discount id." };
  const gid = `gid://shopify/DiscountCodeNode/${numericId}`;

  if (intent === "activate" || intent === "deactivate") {
    const mutationName = intent === "activate" ? "discountCodeActivate" : "discountCodeDeactivate";
    const res = await admin.graphql(
      `#graphql
      mutation ToggleDiscount($id: ID!) {
        ${mutationName}(id: $id) {
          userErrors { field message }
        }
      }`,
      { variables: { id: gid } }
    );
    const data = await res.json();
    const errors = data.data?.[mutationName]?.userErrors ?? [];
    if (errors.length > 0) {
      return { error: errors.map((e: { message: string }) => e.message).join(", ") };
    }
    return { ok: true };
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
        { variables: { id: gid } }
      );
    } catch { /* ignore — already deleted from Shopify */ }

    // Clean up whichever local rows apply — a discount is either a reusable
    // single code or a bulk set, never both, mirroring the dedicated delete
    // actions on each type's own detail page.
    const singleCodeRow = await db.singleCodeDiscount.findFirst({ where: { shop: session.shop, discountId: gid } });
    if (singleCodeRow) {
      await db.singleCodeDiscount.deleteMany({ where: { shop: session.shop, discountId: gid } });
    } else {
      await db.issuedCode.deleteMany({ where: { shop: session.shop, discountId: gid } });
      await db.preUsedCode.deleteMany({ where: { shop: session.shop, discountId: gid } });
      await db.codeRedemption.deleteMany({ where: { shop: session.shop, discountId: gid } });
    }
    return { ok: true };
  }

  return { error: "Unknown intent" };
};

function formatDate(iso: string | null) {
  if (!iso) return "No expiration";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DiscountSetRow({ s, navigate }: { s: DiscountSet; navigate: (path: string) => void }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const setUsageRate = s.totalCodes > 0 ? Math.round((s.usedCodes / s.totalCodes) * 100) : 0;

  const submit = (intent: "activate" | "deactivate" | "delete") => {
    const form = new FormData();
    form.set("intent", intent);
    form.set("numericId", s.numericId);
    fetcher.submit(form, { method: "post" });
  };

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
    <div className="set-row" style={{ display: "flex", alignItems: "center", padding: "12px 12px", borderBottom: "1px solid #e1e3e5", borderRadius: "6px", gap: "12px" }}>
      <div style={{ flex: 3, display: "flex", alignItems: "center", gap: "8px" }}>
        <s-icon type={s.isReusableCode ? "discount-code" : "discount-add"} tone="neutral" size="small" />
        <span style={{ fontSize: "14px" }}>{s.title}</span>
      </div>
      <div style={{ width: "80px" }}>
        {s.status === "ACTIVE" ? (
          <s-badge tone="success">Active</s-badge>
        ) : s.status === "EXPIRED" ? (
          <s-badge tone="critical">Expired</s-badge>
        ) : (
          <s-badge>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</s-badge>
        )}
      </div>
      <span style={{ flex: 2, fontSize: "14px", color: "#6d7175" }}>
        {s.isReusableCode ? `${s.usedCodes} uses (Reusable)` : `${s.usedCodes} / ${s.totalCodes} (${setUsageRate}%)`}
      </span>
      <span style={{ flex: 2, fontSize: "14px", color: "#6d7175" }}>{formatDate(s.endsAt)}</span>
      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
        <s-button
          disabled={busy}
          onClick={() => navigate(s.isReusableCode ? `/app/single-codes/${s.numericId}` : `/app/discounts/${s.numericId}`)}
        >
          View
        </s-button>
        <s-button disabled={busy} commandFor={`actions-menu-${s.numericId}`}>
          Actions
        </s-button>
        <s-menu id={`actions-menu-${s.numericId}`} accessibilityLabel={`Actions for ${s.title}`}>
          {s.status === "ACTIVE" ? (
            <s-button disabled={busy} onClick={() => submit("deactivate")}>Deactivate</s-button>
          ) : (
            <s-button disabled={busy} onClick={() => submit("activate")}>Activate</s-button>
          )}
          <s-button
            tone="critical"
            disabled={busy}
            onClick={() => {
              if (confirm(`Delete "${s.title}"? This removes the discount and all its codes from Shopify. This cannot be undone.`)) {
                submit("delete");
              }
            }}
          >
            Delete
          </s-button>
        </s-menu>
      </div>
    </div>
    {actionError && (
      <s-paragraph style={{ color: "#d72c0d", fontSize: "13px", padding: "0 12px 8px" }}>{actionError}</s-paragraph>
    )}
    </div>
  );
}

export default function DiscountSets() {
  const { sets, totalCodes, totalUsed, activeSets } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const usageRate = totalCodes > 0 ? Math.round((totalUsed / totalCodes) * 100) : 0;

  return (
    <s-page heading="Discount Sets">
      <FormStyles />
      <style>
        {`.set-row { transition: background-color 0.1s; }
          .set-row:hover { background-color: var(--s-color-bg-subdued, #f6f6f7); }`}
      </style>

      <s-section>
        <CardTitle>Overview</CardTitle>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="small" style={{ alignItems: "center" }}>
              <s-icon type="collection-list" tone="info" />
              <s-stack direction="block" gap="none">
                <s-text emphasis="bold" style={{ fontSize: "24px" }}>{sets.length}</s-text>
                <s-text>Total sets</s-text>
              </s-stack>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="small" style={{ alignItems: "center" }}>
              <s-icon type="status-active" tone="success" />
              <s-stack direction="block" gap="none">
                <s-text emphasis="bold" style={{ fontSize: "24px" }}>{activeSets}</s-text>
                <s-text>Active</s-text>
              </s-stack>
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

      <s-section>
        <CardTitle>All discount sets</CardTitle>
        {sets.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No discount sets created yet.</s-paragraph>
            <s-button onClick={() => navigate("/app/discounts/new")}>Create your first discount set</s-button>
          </s-stack>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px", gap: "12px", marginBottom: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 3 }}>Title</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", width: "80px" }}>Status</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 2 }}>Usage</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 2 }}>Expires</span>
              <span style={{ width: "230px" }}></span>
            </div>
            {sets.map((s: DiscountSet) => (
              <DiscountSetRow key={s.numericId} s={s} navigate={navigate} />
            ))}
          </div>
        )}
      </s-section>

      <s-stack direction="inline" gap="base">
        <s-button variant="primary" onClick={() => navigate("/app/discounts/new")}>
          Create new discount set
        </s-button>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
