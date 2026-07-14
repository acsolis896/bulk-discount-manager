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

      <s-section heading="Free">
        <s-stack direction="block" gap="tight">
          <s-text emphasis="bold">$0/month</s-text>
          <s-paragraph>Up to {FREE_PLAN_LIMIT} active discount codes at a time.</s-paragraph>
          {tier === "Free" && <s-badge>Current plan</s-badge>}
        </s-stack>
      </s-section>

      <s-section heading="Starter">
        <s-stack direction="block" gap="tight">
          <s-text emphasis="bold">$19.99/month or $199.90/year</s-text>
          <s-paragraph>Up to {STARTER_PLAN_LIMIT} active discount codes at a time.</s-paragraph>
          {tier === "Starter" && <s-badge>Current plan</s-badge>}
        </s-stack>
      </s-section>

      <s-section heading="Pro">
        <s-stack direction="block" gap="tight">
          <s-text emphasis="bold">$49.99/month or $499.90/year</s-text>
          <s-paragraph>Unlimited active discount codes.</s-paragraph>
          {tier === "Pro" && <s-badge>Current plan</s-badge>}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
