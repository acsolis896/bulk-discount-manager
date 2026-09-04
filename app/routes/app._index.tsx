import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Show a welcome/orientation message only until the merchant has created
  // their first discount with this app.
  const existingRes = await admin.graphql(
    `#graphql
    query HasAnyDiscounts {
      discountNodes(first: 1, query: "function_id:discount-rejection-function-js") {
        nodes { id }
      }
    }`
  );
  const existingData = await existingRes.json();
  const isFirstVisit = (existingData.data?.discountNodes?.nodes ?? []).length === 0;

  return { isFirstVisit };
};

type Card = { href: string; title: string; description: string; icon: string };

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
  const { isFirstVisit } = useLoaderData<typeof loader>();
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
        <s-icon type={card.icon as never} tone="info" />
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
