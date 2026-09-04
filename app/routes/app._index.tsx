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

const SECTIONS = [
  {
    href: "/app/discounts/new",
    title: "Create bulk discounts",
    description: "Generate thousands of unique discount codes in bulk, or import from a CSV.",
  },
  {
    href: "/app/single-codes",
    title: "Reusable codes",
    description: "Create a single shareable code, optionally targeted at a customer segment or tags.",
  },
  {
    href: "/app/additional",
    title: "Discount sets",
    description: "View and manage every discount set you've created with this app.",
  },
  {
    href: "/app/settings",
    title: "Rules",
    description: "Configure product types that automatically block discount codes at checkout.",
  },
  {
    href: "/app/plans",
    title: "Plans",
    description: "See your current plan and active discount code usage.",
  },
  {
    href: "/app/contact",
    title: "Contact Us",
    description: "Reach support by email or live chat.",
  },
];

export default function Home() {
  const { isFirstVisit } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Discount Codes & Rules">
      {isFirstVisit && (
        <s-section heading="Welcome">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Beyond standard discount codes, this app gives you two things most Shopify discount
              apps don't: percentage or fixed-amount discounts that apply to just one eligible
              item per order, and checkout rules that automatically block codes when restricted
              items (like gift-with-purchase products) are in the cart.
            </s-paragraph>
            <s-paragraph style={{ fontSize: "13px", color: "#6d7175" }}>
              Get started below by generating bulk codes for a promotion, or use{" "}
              <strong>Reusable codes</strong> for a single shareable code. Set up blocking rules
              anytime under <strong>Rules</strong>.
            </s-paragraph>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Get started">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
          {SECTIONS.map((section) => (
            <div
              key={section.href}
              onClick={() => navigate(section.href)}
              style={{
                padding: "16px",
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                cursor: "pointer",
                background: "#fff",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>
                {section.title}
              </div>
              <div style={{ fontSize: "13px", color: "#6d7175" }}>
                {section.description}
              </div>
            </div>
          ))}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
