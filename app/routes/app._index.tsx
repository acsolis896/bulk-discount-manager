import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getRecentCodeStats } from "../home-stats.server";
import { formatMoney } from "../home-stats";
import { CardTitle } from "../components/CardTitle";
import { FormStyles } from "../components/FormStyles";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Drives both the welcome banner and the "Getting started" checklist below —
  // asyncUsageCount tells us whether any code has actually been redeemed yet.
  const existingRes = await admin.graphql(
    `#graphql
    query HasAnyDiscounts {
      discountNodes(first: 25, query: "function_id:discount-rejection-function-js") {
        nodes {
          id
          discount {
            ... on DiscountCodeApp { asyncUsageCount }
          }
        }
      }
    }`
  );
  const existingData = await existingRes.json();
  const discountNodes = existingData.data?.discountNodes?.nodes ?? [];
  const hasAnyDiscount = discountNodes.length > 0;
  const hasAnyUsage = discountNodes.some(
    (n: { discount?: { asyncUsageCount?: number } }) => (n.discount?.asyncUsageCount ?? 0) > 0
  );

  const blockedTypeCount = await db.blockedProductType.count({ where: { shop: session.shop } });

  const isFirstVisit = !hasAnyDiscount;
  // Optional steps are shown as bonus ticks; only the required ones keep the card on the page.
  const checklist = [
    { key: "create", label: "Create your first discount (bulk or reusable)", done: hasAnyDiscount, href: "/app/discounts/new", optional: false },
    { key: "rules", label: "Add a blocked product type rule (optional)", done: blockedTypeCount > 0, href: "/app/settings", optional: true },
    { key: "usage", label: "See a code used at checkout", done: hasAnyUsage, href: "/app/additional", optional: false },
  ];
  // For testing: GETTING_STARTED_ALWAYS_SHOW=true keeps the card on the page even when every step is done.
  // Leave it unset on production.
  const alwaysShow = process.env.GETTING_STARTED_ALWAYS_SHOW === "true";
  const showChecklist = alwaysShow || checklist.some((c) => !c.optional && !c.done);

  // Only shown once the store has a discount; a failure here must not break the Home page.
  let stats = null;
  if (hasAnyDiscount) {
    try {
      stats = await getRecentCodeStats(session.shop);
    } catch (error) {
      console.error("Failed to load recent code stats", error);
    }
  }

  return { isFirstVisit, checklist, showChecklist, stats };
};

type Card = { href: string; title: string; description: string; icon: string };

const ICON_PURPLE = "#6B46C1";

const CREATE_CARDS: Card[] = [
  {
    href: "/app/discounts/new",
    title: "Create bulk discounts",
    description: "Generate thousands of unique discount codes in bulk, or import from a CSV.",
    icon: "discount-add",
  },
  {
    href: "/app/single-codes/new",
    title: "Create reusable codes",
    description: "Create a single shareable code, optionally targeted at a customer segment or tags.",
    icon: "discount-code",
  },
];

const MANAGE_CARDS: Card[] = [
  {
    href: "/app/additional",
    title: "Discount sets",
    description: "View and manage every discount set you've created with this app.",
    icon: "list-bulleted",
  },
  {
    href: "/app/settings",
    title: "Rules",
    description: "Configure product types that automatically block discount codes at checkout.",
    icon: "shield-check-mark",
  },
  {
    href: "/app/plans",
    title: "Plans",
    description: "See your current plan and active discount code usage.",
    icon: "plan",
  },
];

type UseCase = {
  title: string;
  icon: string;
  blurb: string;
  buttons: { label: string; href: string }[];
};

const USE_CASES: UseCase[] = [
  {
    title: "Influencer, affiliate and employee codes",
    icon: "star",
    blurb: "Give each partner or employee their own code: a reusable code per person, or a bulk set imported from a CSV.",
    buttons: [
      { label: "Create a reusable code", href: "/app/single-codes/new" },
      { label: "Create a bulk set", href: "/app/discounts/new" },
    ],
  },
  {
    title: "Unique codes for a campaign or giveaway",
    icon: "discount-add",
    blurb: "Generate hundreds or thousands of single-use codes at once, then export them for an email or a giveaway.",
    buttons: [{ label: "Create a bulk set", href: "/app/discounts/new" }],
  },
  {
    title: "Discount one item per order",
    icon: "discount-code",
    blurb: "Apply a percentage or a fixed amount to just the highest-priced eligible item in the cart, such as 50% off one item. Shopify's own percentage discounts apply to every eligible item.",
    buttons: [{ label: "Create a reusable code", href: "/app/single-codes/new" }],
  },
  {
    title: "Protect a free gift",
    icon: "shield-check-mark",
    blurb: "Block discount codes when a gift-with-purchase product is in the cart.",
    buttons: [{ label: "Open Rules", href: "/app/settings" }],
  },
];

const CONTACT_CARD: Card = {
  href: "/app/contact",
  title: "Contact Us",
  description: "Reach support by email or live chat.",
  icon: "chat",
};

export default function Home() {
  const { isFirstVisit, checklist, showChecklist, stats } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // Every use case has the same shape (icon and title, a sentence, buttons pinned to the bottom), and
  // the grid stretches the boxes to one height, so a longer sentence doesn't make one box lopsided.
  const renderUseCase = (u: UseCase) => (
    <div
      key={u.title}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        height: "100%",
        boxSizing: "border-box",
        padding: "16px",
        border: "1px solid #e1e3e5",
        borderRadius: "8px",
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <span style={{ color: ICON_PURPLE, flexShrink: 0, display: "inline-flex" }}>
          <s-icon type={u.icon as never} />
        </span>
        <div style={{ fontSize: "14px", fontWeight: 600 }}>{u.title}</div>
      </div>
      <div style={{ fontSize: "13px", color: "#6d7175" }}>{u.blurb}</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "auto", paddingTop: "6px" }}>
        {u.buttons.map((b) => (
          <s-button key={b.label} onClick={() => navigate(b.href)}>{b.label}</s-button>
        ))}
      </div>
    </div>
  );

  const renderCard = (card: Card) => (
    <s-box
      key={card.title}
      className="home-card"
      onClick={() => navigate(card.href)}
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="base"
      style={{ cursor: "pointer" }}
    >
      <s-stack direction="inline" gap="base" style={{ alignItems: "flex-start" }}>
        <s-icon type={card.icon as never} style={{ color: ICON_PURPLE }} />
        <s-stack direction="block" gap="none">
          <s-text emphasis="bold">{card.title}</s-text>
          <s-text style={{ fontSize: "13px", color: "#6d7175" }}>{card.description}</s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );

  return (
    <s-page heading="Airtight Discount Code Rules">
      <FormStyles />
      <style>
        {`.home-card { transition: box-shadow 0.15s, border-color 0.15s; }
          .home-card:hover { box-shadow: 0 1px 6px rgba(0,0,0,0.08); border-color: #8a8a8a; }`}
      </style>

      {isFirstVisit && (
        <s-banner tone="info" title="Welcome!">
          <s-paragraph>
            Beyond standard discount codes, this app gives you two things most Shopify discount
            apps don't: percentage or fixed-amount discounts that apply to just one eligible item
            per order, and checkout rules that automatically block codes when restricted items
            (like gift-with-purchase products) are in the cart.
          </s-paragraph>
        </s-banner>
      )}

      {showChecklist && (
        <s-section>
          <CardTitle>Getting started</CardTitle>
          <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "-8px", marginBottom: "12px" }}>
            {checklist.filter((c) => c.done).length} of {checklist.length} steps done
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "8px" }}>
            {checklist.map((step) => (
              <div
                key={step.key}
                onClick={() => navigate(step.href)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  opacity: step.done ? 0.6 : 1,
                }}
              >
                <s-icon
                  type={step.done ? "check-circle-filled" : "circle"}
                  tone={step.done ? "success" : "neutral"}
                />
                <s-text style={step.done ? { textDecoration: "line-through" } : {}}>{step.label}</s-text>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>Start from a use case</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", alignItems: "stretch" }}>
              {USE_CASES.map(renderUseCase)}
            </div>
          </div>
        </s-section>
      )}

      {stats && (
        <s-section>
          <CardTitle>Last 30 days</CardTitle>
          {stats.orders === 0 ? (
            <s-paragraph>
              No orders have used your codes in the last 30 days. When a customer uses one at checkout, it will show up here.
            </s-paragraph>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div style={{ fontSize: "24px", fontWeight: 650 }}>{stats.orders.toLocaleString("en-US")}</div>
                <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "8px" }}>Orders that used a code</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div style={{ fontSize: "24px", fontWeight: 650 }}>{formatMoney(stats.sales[0].total, stats.sales[0].currency)}</div>
                <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "8px" }}>
                  Sales from those orders
                  {stats.sales.length > 1 ? ` (${stats.sales[0].currency}; ${stats.sales.length - 1} more currenc${stats.sales.length - 1 === 1 ? "y" : "ies"} not shown)` : ""}
                </div>
              </s-box>
              {stats.topCode && (
                <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                  <div style={{ fontSize: "24px", fontWeight: 650, fontFamily: "monospace", wordBreak: "break-all" }}>{stats.topCode.code}</div>
                  <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "8px" }}>
                    Most used code ({stats.topCode.orders.toLocaleString("en-US")} order{stats.topCode.orders === 1 ? "" : "s"})
                  </div>
                </s-box>
              )}
            </div>
          )}
        </s-section>
      )}

      <div role="heading" aria-level={2} style={{ fontSize: "24px", fontWeight: 650, lineHeight: "32px", margin: "32px 4px 12px" }}>
        Quick links
      </div>

      <s-section>
        <CardTitle>Create a discount</CardTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
          {CREATE_CARDS.map(renderCard)}
        </div>
      </s-section>

      <s-section>
        <CardTitle>Manage & configure</CardTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
          {MANAGE_CARDS.map(renderCard)}
        </div>
      </s-section>

      <s-section>
        <CardTitle>Need help?</CardTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px", maxWidth: "240px" }}>
          {renderCard(CONTACT_CARD)}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
