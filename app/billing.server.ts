import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { tierForPlanName, limitForTier, type PlanTier } from "./billing";

// Plans are now defined in Partners Dashboard (Shopify App Pricing) rather
// than in code — there's no `billing` config to pass to shopifyApp()
// anymore. With unstable_managedPricingSupport enabled, billing.check()
// takes just { isTest } and returns every active subscription regardless
// of plan, so we don't need to pass plan names to filter by.
//
// The real BillingContext type's `check` signature is generic over the
// app's exact billing config, which makes it awkward to name here. This
// helper is only ever called with the real billing context from
// `authenticate.admin()`, so we accept it as `any` rather than fight the
// SDK's generic inference.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCurrentPlan(
  billing: any
): Promise<{ planName: string | null; subscriptionId: string | null; tier: PlanTier; limit: number | null }> {
  const result: { appSubscriptions: { id: string; name: string; status: string }[] } = await billing.check({
    isTest: process.env.NODE_ENV !== "production",
  });
  const active = result.appSubscriptions.find((s) => s.status === "ACTIVE");
  const planName = active?.name ?? null;
  const tier = tierForPlanName(planName);
  return { planName, subscriptionId: active?.id ?? null, tier, limit: limitForTier(tier) };
}

/**
 * Counts unused ("active") discount codes created by this app across all
 * discounts, stopping as soon as the count exceeds `limit` — callers only
 * need to know whether the shop is at/over its cap, not the exact count for
 * shops with far more codes than any capped plan allows.
 */
export async function countActiveCodes(admin: AdminApiContext, limit: number | null): Promise<number> {
  if (limit === null) return 0; // unlimited plan — no need to count

  let total = 0;
  let cursor: string | null = null;
  do {
    const res = await admin.graphql(
      `#graphql
      query CountActiveCodes($after: String) {
        discountNodes(first: 20, after: $after, query: "function_id:discount-rejection-function-js") {
          nodes {
            discount {
              __typename
              ... on DiscountCodeApp {
                codes(first: 250) {
                  nodes { asyncUsageCount }
                }
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
      if (node.discount?.__typename !== "DiscountCodeApp") continue;
      const codes = node.discount.codes?.nodes ?? [];
      total += codes.filter((c: { asyncUsageCount: number }) => c.asyncUsageCount === 0).length;
    }
    if (total > limit) return total;
    const pageInfo = data.data?.discountNodes?.pageInfo;
    cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return total;
}

export async function checkCodeQuota(
  admin: AdminApiContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  billing: any,
  requestedCount: number
): Promise<{ allowed: boolean; tier: PlanTier; limit: number | null; current: number }> {
  const { tier, limit } = await getCurrentPlan(billing);
  if (limit === null) return { allowed: true, tier, limit, current: 0 };

  const current = await countActiveCodes(admin, limit);
  return { allowed: current + requestedCount <= limit, tier, limit, current };
}
