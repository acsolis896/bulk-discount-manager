// Plan names, limits, and pure helpers shared between server code and route
// components. Kept out of billing.server.ts because React Router strips
// `.server.ts` modules from the client bundle, and app.plans.tsx's default
// export (not just its loader/action) needs these constants.
//
// Plans are defined in Partners Dashboard (Shopify App Pricing), not in
// code — each has an "Internal plan handle" (what code should match
// against) separate from its merchant-facing display name. We don't know
// for certain which one billing.check() surfaces, so tierForPlanName
// normalizes and compares against the handle, which will also match the
// display name here since both were set to the same word.

export const PLAN_STARTER = "starter";
export const PLAN_PRO = "pro";

export const FREE_PLAN_LIMIT = 10;
export const STARTER_PLAN_LIMIT = 1000;
// Pro = unlimited (limit is null)

export type PlanTier = "Free" | "Starter" | "Pro";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function tierForPlanName(planName: string | null): PlanTier {
  if (!planName) return "Free";
  const n = normalize(planName);
  if (n === PLAN_STARTER) return "Starter";
  if (n === PLAN_PRO) return "Pro";
  return "Free";
}

export function limitForTier(tier: PlanTier): number | null {
  if (tier === "Starter") return STARTER_PLAN_LIMIT;
  if (tier === "Pro") return null; // unlimited
  return FREE_PLAN_LIMIT;
}
