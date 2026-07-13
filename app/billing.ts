// Plan names, limits, and pure helpers shared between server code and route
// components. Kept out of billing.server.ts because React Router strips
// `.server.ts` modules from the client bundle, and app.plans.tsx's default
// export (not just its loader/action) needs these constants.

export const PLAN_STARTER_MONTHLY = "Starter";
export const PLAN_STARTER_ANNUAL = "Starter (Annual)";
export const PLAN_PRO_MONTHLY = "Pro";
export const PLAN_PRO_ANNUAL = "Pro (Annual)";

export const ALL_PAID_PLANS = [
  PLAN_STARTER_MONTHLY,
  PLAN_STARTER_ANNUAL,
  PLAN_PRO_MONTHLY,
  PLAN_PRO_ANNUAL,
];

export const FREE_PLAN_LIMIT = 10;
export const STARTER_PLAN_LIMIT = 1000;
// Pro = unlimited (limit is null)

export type PlanTier = "Free" | "Starter" | "Pro";

export function tierForPlanName(planName: string | null): PlanTier {
  if (planName === PLAN_STARTER_MONTHLY || planName === PLAN_STARTER_ANNUAL) return "Starter";
  if (planName === PLAN_PRO_MONTHLY || planName === PLAN_PRO_ANNUAL) return "Pro";
  return "Free";
}

export function limitForTier(tier: PlanTier): number | null {
  if (tier === "Starter") return STARTER_PLAN_LIMIT;
  if (tier === "Pro") return null; // unlimited
  return FREE_PLAN_LIMIT;
}
