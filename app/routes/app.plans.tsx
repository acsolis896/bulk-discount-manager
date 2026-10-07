import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { PLAN_LIMITS, type PlanTier } from "../billing";
import { getPlanUsage } from "../billing.server";

// Matches the app handle Shopify shows in admin.shopify.com URLs for this
// app (e.g. .../apps/bulk-discount-manager-7) — used to deep-link merchants
// straight to the native plan selection page.
const APP_HANDLE = "bulk-discount-manager-7";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const usage = await getPlanUsage(admin, billing, session.shop);
  const storeHandle = session.shop.replace(".myshopify.com", "");
  const pricingUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
  // A private plan (e.g. "Multi-store Pro") maps to a standard tier for its
  // limits but has its own price, so don't show it as the public tier.
  const isCustomPlan = usage.planName !== null && usage.planName.trim().toLowerCase() !== usage.tier.toLowerCase();
  return { ...usage, pricingUrl, isCustomPlan };
};

const PRICES: Record<PlanTier, string> = {
  Free: "$0/month",
  Starter: "$19.99/month or $199.90/year",
  Pro: "$49.99/month or $499.90/year",
};

// Built from the same rules the app enforces, so this page can't drift from them.
function featuresFor(tier: PlanTier): string[] {
  const l = PLAN_LIMITS[tier];
  const list: string[] = [
    l.reusableCodes === null ? "Unlimited reusable codes" : `Up to ${l.reusableCodes} reusable codes`,
    l.bulkCodes === null ? "Unlimited active bulk codes" : `Up to ${l.bulkCodes.toLocaleString("en-US")} active bulk codes`,
    l.blockedProductTypes === null
      ? "Unlimited blocked product types"
      : `${l.blockedProductTypes} blocked product type${l.blockedProductTypes === 1 ? "" : "s"}`,
    "Per-customer limits, item caps and CSV import",
  ];
  if (l.features.countryRestriction) list.push("Country restrictions");
  if (l.features.discountCap) list.push("Maximum discount per order");
  if (l.features.tagTargeting) list.push("Customer tag and segment targeting");
  if (l.prioritySupport) list.push("Priority support");
  return list;
}

const PLANS: PlanTier[] = ["Free", "Starter", "Pro"];

const usageText = (used: number, limit: number | null, noun: string) =>
  limit === null ? `Unlimited ${noun}` : `${used} / ${limit} ${noun} used`;

export default function PlansPage() {
  const { tier, bulkLimit, bulkUsed, reusableLimit, reusableUsed, pricingUrl, planName, isCustomPlan } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Plans">
      <s-section heading="View or change plan">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            You're on the <s-text emphasis="bold">{isCustomPlan ? planName : tier}</s-text> plan
            {isCustomPlan ? ` (${tier} features)` : ""}.{" "}
            {usageText(reusableUsed, reusableLimit, "reusable codes")}. {usageText(bulkUsed, bulkLimit, "active bulk codes")}.
          </s-paragraph>
          <div>
            <s-button href={pricingUrl} target="_top" variant="primary">
              Change plan
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Compare plans">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
          {PLANS.map((planTier) => {
            const isCurrent = !isCustomPlan && tier === planTier;
            return (
              <s-box
                key={planTier}
                padding="base"
                borderWidth={isCurrent ? "large" : "base"}
                borderColor={isCurrent ? "strong" : "subdued"}
                borderRadius="base"
                background="base"
              >
                <s-stack direction="block" gap="small">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                    <s-text emphasis="bold" style={{ fontSize: "16px" }}>{planTier}</s-text>
                    {isCurrent && <s-badge tone="success">Current plan</s-badge>}
                  </div>
                  <s-text emphasis="bold">{PRICES[planTier]}</s-text>
                  {featuresFor(planTier).map((line) => (
                    <s-paragraph key={line} style={{ fontSize: "13px", color: "#6d7175" }}>✓ {line}</s-paragraph>
                  ))}
                </s-stack>
              </s-box>
            );
          })}
          {isCustomPlan && (
            <s-box padding="base" borderWidth="large" borderColor="strong" borderRadius="base" background="base">
              <s-stack direction="block" gap="small">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                  <s-text emphasis="bold" style={{ fontSize: "16px" }}>{planName}</s-text>
                  <s-badge tone="success">Current plan</s-badge>
                </div>
                <s-text emphasis="bold">Custom plan</s-text>
                <s-paragraph style={{ fontSize: "13px", color: "#6d7175" }}>
                  {featuresFor(tier).join(" · ")}
                </s-paragraph>
              </s-stack>
            </s-box>
          )}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
