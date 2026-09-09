import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

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
  const checklist = [
    { key: "create", label: "Create your first discount", done: hasAnyDiscount, href: "/app/discounts/new" },
    { key: "rules", label: "Add a blocked product type rule (optional)", done: blockedTypeCount > 0, href: "/app/settings" },
    { key: "usage", label: "See a code used at checkout", done: hasAnyUsage, href: "/app/additional" },
  ];
  const showChecklist = checklist.some((c) => !c.done);

  return { isFirstVisit, checklist, showChecklist };
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

const CONTACT_CARD: Card = {
  href: "/app/contact",
  title: "Contact Us",
  description: "Reach support by email or live chat.",
  icon: "chat",
};

export default function Home() {
  const { isFirstVisit, checklist, showChecklist } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const renderCard = (card: Card) => (
    <s-box
      key={card.href}
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
    <s-page heading="Discount Codes & Rules">
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
        <s-section heading="Getting started">
          <s-stack direction="block" gap="tight">
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
          </s-stack>
        </s-section>
      )}

      <s-section heading="Create a discount">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
          {CREATE_CARDS.map(renderCard)}
        </div>
      </s-section>

      <s-section heading="Manage & configure">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
          {MANAGE_CARDS.map(renderCard)}
        </div>
      </s-section>

      <s-section heading="Need help?">
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
