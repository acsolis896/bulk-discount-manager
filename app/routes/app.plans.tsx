import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  PLAN_STARTER_MONTHLY,
  PLAN_STARTER_ANNUAL,
  PLAN_PRO_MONTHLY,
  PLAN_PRO_ANNUAL,
  FREE_PLAN_LIMIT,
  STARTER_PLAN_LIMIT,
  getCurrentPlan,
  countActiveCodes,
} from "../billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);
  const { planName, tier, limit } = await getCurrentPlan(billing);
  const current = await countActiveCodes(admin, limit);
  return { planName, tier, limit, current };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const isTest = process.env.NODE_ENV !== "production";
  const returnUrl = new URL("/app/plans", process.env.SHOPIFY_APP_URL || request.url).toString();

  if (intent === "subscribe") {
    const plan = String(formData.get("plan") || "");
    if (![PLAN_STARTER_MONTHLY, PLAN_STARTER_ANNUAL, PLAN_PRO_MONTHLY, PLAN_PRO_ANNUAL].includes(plan)) {
      return { error: "Unknown plan." };
    }
    // billing.request() redirects (throws), it never returns normally.
    // The SDK's `plan` type is generic over the app's exact billing config
    // keys, which TS can't narrow from a runtime string — validated above.
    return await billing.request({ plan: plan as never, isTest, returnUrl });
  }

  if (intent === "cancel") {
    const subscriptionId = String(formData.get("subscriptionId") || "");
    if (!subscriptionId) return { error: "No active subscription to cancel." };
    await billing.cancel({ subscriptionId, isTest, prorate: true });
    return { cancelled: true };
  }

  return { error: "Unknown intent." };
};

export default function PlansPage() {
  const { planName, tier, limit, current } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data as { error?: string; cancelled?: boolean } | undefined;

  const subscribe = (plan: string) => {
    const form = new FormData();
    form.set("intent", "subscribe");
    form.set("plan", plan);
    fetcher.submit(form, { method: "post" });
  };

  const cancel = () => {
    if (!confirm("Cancel your current plan and move back to Free?")) return;
    const form = new FormData();
    form.set("intent", "cancel");
    fetcher.submit(form, { method: "post" });
  };

  return (
    <s-page heading="Plans">
      {result?.error && (
        <s-banner tone="critical">
          <s-paragraph>{result.error}</s-paragraph>
        </s-banner>
      )}
      {result?.cancelled && (
        <s-banner tone="success">
          <s-paragraph>Subscription cancelled. You're back on the Free plan.</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Current usage">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            You're on the <s-text emphasis="bold">{tier}</s-text> plan.{" "}
            {limit === null
              ? "Unlimited active discount codes."
              : `${current} / ${limit} active discount codes used.`}
          </s-paragraph>
          {tier !== "Free" && (
            <div>
              <s-button tone="critical" disabled={isSubmitting} onClick={cancel}>
                Cancel plan
              </s-button>
            </div>
          )}
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
          <s-paragraph>Up to {STARTER_PLAN_LIMIT} active discount codes at a time.</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              disabled={isSubmitting || planName === PLAN_STARTER_MONTHLY}
              onClick={() => subscribe(PLAN_STARTER_MONTHLY)}
            >
              {planName === PLAN_STARTER_MONTHLY ? "Current plan" : "$19.99/month"}
            </s-button>
            <s-button
              disabled={isSubmitting || planName === PLAN_STARTER_ANNUAL}
              onClick={() => subscribe(PLAN_STARTER_ANNUAL)}
            >
              {planName === PLAN_STARTER_ANNUAL ? "Current plan" : "$199.90/year (2 months free)"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Pro">
        <s-stack direction="block" gap="tight">
          <s-paragraph>Unlimited active discount codes.</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              disabled={isSubmitting || planName === PLAN_PRO_MONTHLY}
              onClick={() => subscribe(PLAN_PRO_MONTHLY)}
            >
              {planName === PLAN_PRO_MONTHLY ? "Current plan" : "$49.99/month"}
            </s-button>
            <s-button
              disabled={isSubmitting || planName === PLAN_PRO_ANNUAL}
              onClick={() => subscribe(PLAN_PRO_ANNUAL)}
            >
              {planName === PLAN_PRO_ANNUAL ? "Current plan" : "$499.90/year (2 months free)"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
