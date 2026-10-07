import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { tierForPlanName, limitForTier, parseTierOverride, reusableLimitFor, canUseFeature, type PlanFeature, type PlanTier } from "./billing";
import db from "./db.server";

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
  // Staging only (the variable is never set on production): act as a given plan for testing.
  const override = parseTierOverride(process.env.PLAN_TIER_OVERRIDE);
  if (override) {
    return { planName: `${override} (staging override)`, subscriptionId: null, tier: override, limit: limitForTier(override) };
  }

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
export async function countActiveCodes(
  admin: AdminApiContext,
  limit: number | null,
  // Reusable codes are limited separately, so their discount IDs are left out of this count.
  excludeDiscountIds: ReadonlySet<string> = new Set()
): Promise<number> {
  if (limit === null) return 0; // unlimited plan — no need to count

  let total = 0;
  let cursor: string | null = null;
  do {
    const res = await admin.graphql(
      `#graphql
      query CountActiveCodes($after: String) {
        discountNodes(first: 20, after: $after, query: "function_id:discount-rejection-function-js") {
          nodes {
            id
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
      if (excludeDiscountIds.has(node.id)) continue;
      const codes = node.discount.codes?.nodes ?? [];
      total += codes.filter((c: { asyncUsageCount: number }) => c.asyncUsageCount === 0).length;
    }
    if (total > limit) return total;
    const pageInfo = data.data?.discountNodes?.pageInfo;
    cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return total;
}

/** Bulk codes: active (never used) codes, not counting reusable codes. */
export async function checkCodeQuota(
  admin: AdminApiContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  billing: any,
  shop: string,
  requestedCount: number
): Promise<{ allowed: boolean; tier: PlanTier; limit: number | null; current: number }> {
  const { tier, limit } = await getCurrentPlan(billing);
  if (limit === null) return { allowed: true, tier, limit, current: 0 };

  const reusable = await db.singleCodeDiscount.findMany({ where: { shop }, select: { discountId: true } });
  const current = await countActiveCodes(admin, limit, new Set(reusable.map((r) => r.discountId)));
  return { allowed: current + requestedCount <= limit, tier, limit, current };
}

/**
 * Forgets reusable codes that no longer exist in Shopify (deleted in the Shopify admin, which
 * the app isn't told about), so they don't count against the plan. If Shopify can't be asked,
 * nothing is removed.
 */
async function pruneDeletedReusableCodes(admin: AdminApiContext, shop: string): Promise<void> {
  const rows = await db.singleCodeDiscount.findMany({ where: { shop }, select: { discountId: true } });
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((r) => r.discountId);
    try {
      const res = await admin.graphql(
        `#graphql
        query ReusableCodeNodes($ids: [ID!]!) {
          nodes(ids: $ids) { ... on DiscountCodeNode { id } }
        }`,
        { variables: { ids: batch } }
      );
      const data = (await res.json()) as { data?: { nodes?: ({ id?: string } | null)[] }; errors?: unknown };
      if (data.errors || !Array.isArray(data.data?.nodes)) return;
      const missing = batch.filter((_, idx) => data.data!.nodes![idx] == null);
      if (missing.length > 0) {
        await db.singleCodeDiscount.deleteMany({ where: { shop, discountId: { in: missing } } });
      }
    } catch {
      return;
    }
  }
}

/** Reusable codes: counted for as long as they exist, however often they've been used. */
export async function checkReusableQuota(
  admin: AdminApiContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  billing: any,
  shop: string
): Promise<{ allowed: boolean; tier: PlanTier; limit: number | null; current: number }> {
  const { tier } = await getCurrentPlan(billing);
  const limit = reusableLimitFor(tier, shop);
  if (limit === null) return { allowed: true, tier, limit, current: 0 };

  let current = await db.singleCodeDiscount.count({ where: { shop } });
  if (current >= limit) {
    // At the limit: make sure none of these were deleted in Shopify before saying no.
    await pruneDeletedReusableCodes(admin, shop);
    current = await db.singleCodeDiscount.count({ where: { shop } });
  }
  return { allowed: current < limit, tier, limit, current };
}

/** What this shop is using against its plan, for the Plans page. */
export async function getPlanUsage(
  admin: AdminApiContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  billing: any,
  shop: string
): Promise<{
  tier: PlanTier;
  planName: string | null;
  bulkLimit: number | null;
  bulkUsed: number;
  reusableLimit: number | null;
  reusableUsed: number;
}> {
  const { tier, planName, limit: bulkLimit } = await getCurrentPlan(billing);
  const reusable = await db.singleCodeDiscount.findMany({ where: { shop }, select: { discountId: true } });
  const bulkUsed = await countActiveCodes(admin, bulkLimit, new Set(reusable.map((r) => r.discountId)));
  return {
    tier,
    planName,
    bulkLimit,
    bulkUsed,
    reusableLimit: reusableLimitFor(tier, shop),
    reusableUsed: reusable.length,
  };
}

/**
 * Which locked features this shop can use, for showing or hiding controls. A feature a code already
 * has stays available, so someone editing it isn't locked out of what they already set.
 */
export async function getPlanFeatures(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  billing: any,
  shop: string,
  alreadyUsing: Partial<Record<PlanFeature, boolean>> = {}
): Promise<Record<PlanFeature, boolean>> {
  const { tier } = await getCurrentPlan(billing);
  const can = (feature: PlanFeature) => canUseFeature(tier, shop, feature) || Boolean(alreadyUsing[feature]);
  return { countryRestriction: can("countryRestriction"), discountCap: can("discountCap"), tagTargeting: can("tagTargeting") };
}
