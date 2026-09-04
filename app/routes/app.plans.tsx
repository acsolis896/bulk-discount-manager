import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { FREE_PLAN_LIMIT, STARTER_PLAN_LIMIT } from "../billing";
import { getCurrentPlan, countActiveCodes } from "../billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);
  const { tier, limit } = await getCurrentPlan(billing);
  const current = await countActiveCodes(admin, limit);
  return { tier, limit, current };
};

type PlanTier = "Free" | "Starter" | "Pro";

const PLANS: { tier: PlanTier; price: string; feature: string }[] = [
  { tier: "Free", price: "$0/month", feature: `Up to ${FREE_PLAN_LIMIT} active discount codes at a time.` },
  { tier: "Starter", price: "$19.99/month or $199.90/year", feature: `Up to ${STARTER_PLAN_LIMIT} active discount codes at a time.` },
  { tier: "Pro", price: "$49.99/month or $499.90/year", feature: "Unlimited active discount codes." },
];

export default function PlansPage() {
  const { tier, limit, current } = useLoaderData<typeof loader>();

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
          <s-paragraph style={{ fontSize: "13px", color: "#6d7175" }}>
            To subscribe, change, or cancel your plan, use the pricing page on this app's
            Shopify App Store listing, or manage it from your Shopify admin's app settings.
          </s-paragraph>
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
