import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { FREE_PLAN_LIMIT, STARTER_PLAN_LIMIT } from "../billing";
import { getCurrentPlan, countActiveCodes } from "../billing.server";

// Matches the app handle Shopify shows in admin.shopify.com URLs for this
// app (e.g. .../apps/bulk-discount-manager-7) — used to deep-link merchants
// straight to the native plan selection page.
const APP_HANDLE = "bulk-discount-manager-7";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const { tier, limit } = await getCurrentPlan(billing);
  const current = await countActiveCodes(admin, limit);
  const storeHandle = session.shop.replace(".myshopify.com", "");
  const pricingUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
  return { tier, limit, current, pricingUrl };
};

type PlanTier = "Free" | "Starter" | "Pro";

const PLANS: { tier: PlanTier; price: string; feature: string }[] = [
  { tier: "Free", price: "$0/month", feature: `Up to ${FREE_PLAN_LIMIT} active discount codes at a time.` },
  { tier: "Starter", price: "$19.99/month or $199.90/year", feature: `Up to ${STARTER_PLAN_LIMIT} active discount codes at a time.` },
  { tier: "Pro", price: "$49.99/month or $499.90/year", feature: "Unlimited active discount codes." },
];

export default function PlansPage() {
  const { tier, limit, current, pricingUrl } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Plans">
      <s-section heading="Current usage">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            You're on the <s-text emphasis="bold">{tier}</s-text> plan.{" "}
            {limit === null
              ? "Unlimited active discount codes."
              : `${current} / ${limit} active discount codes used.`}
          </s-paragraph>
          <div>
            <s-button href={pricingUrl} target="_top" variant="primary">
              Change plan
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Choose a plan">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
          {PLANS.map((plan) => {
            const isCurrent = tier === plan.tier;
            return (
              <s-box
                key={plan.tier}
                padding="base"
                borderWidth={isCurrent ? "large" : "base"}
                borderColor={isCurrent ? "strong" : "subdued"}
                borderRadius="base"
                background="base"
              >
                <s-stack direction="block" gap="tight">
                  <s-stack direction="inline" gap="tight" style={{ alignItems: "center", justifyContent: "space-between" }}>
                    <s-text emphasis="bold" style={{ fontSize: "16px" }}>{plan.tier}</s-text>
                    {isCurrent && <s-badge tone="success">Current plan</s-badge>}
                  </s-stack>
                  <s-text emphasis="bold">{plan.price}</s-text>
                  <s-paragraph style={{ fontSize: "13px", color: "#6d7175" }}>{plan.feature}</s-paragraph>
                </s-stack>
              </s-box>
            );
          })}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
