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

// Paid-only features (PLAN_LIMITS.*.features) are built and tested but switched off: while this is
// false every plan can use every feature, and the upgrade notes, save-time checks and Plans page
// feature lines stay hidden. Set it to true to start restricting them to Starter and above.
export const FEATURE_LOCKS_ENABLED = false;

export const PLAN_STARTER = "starter";
export const PLAN_PRO = "pro";

export type PlanTier = "Free" | "Starter" | "Pro";

// Features that need a paid plan. Customer tag and segment targeting, items per order,
// collections, CSV import and bulk generation are on every plan.
export type PlanFeature = "countryRestriction" | "discountCap" | "usesPerCustomer" | "maxCartItems";

export interface PlanLimits {
  /** Reusable codes that can exist at once (null = unlimited). */
  reusableCodes: number | null;
  /** Active (never used) bulk codes at once (null = unlimited). */
  bulkCodes: number | null;
  /** Blocked product types on the Blocked products page (null = unlimited). */
  blockedProductTypes: number | null;
  features: Record<PlanFeature, boolean>;
  prioritySupport: boolean;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  Free: {
    reusableCodes: 2,
    bulkCodes: 50,
    blockedProductTypes: 1,
    features: { countryRestriction: false, discountCap: false, usesPerCustomer: false, maxCartItems: false },
    prioritySupport: false,
  },
  Starter: {
    reusableCodes: 10,
    bulkCodes: 5000,
    blockedProductTypes: 5,
    features: { countryRestriction: true, discountCap: true, usesPerCustomer: true, maxCartItems: true },
    prioritySupport: false,
  },
  Pro: {
    reusableCodes: null,
    bulkCodes: null,
    blockedProductTypes: null,
    features: { countryRestriction: true, discountCap: true, usesPerCustomer: true, maxCartItems: true },
    prioritySupport: true,
  },
};

// Shops that already had more than the plan allows, or already used a gated feature, when these
// limits were introduced (2026-10-07). They keep what they had; nothing new beyond it. Existing
// codes are never switched off by plan changes (limits and locks apply only when creating or editing).
const GRANDFATHERED: {
  /** Shop -> reusable codes it may keep (never less than the plan allows). */
  reusableCodes: Record<string, number>;
  /** Gated feature -> shops that already used it and may keep using it. */
  features: Partial<Record<PlanFeature, string[]>>;
} = {
  // Raised from 3 to 5 on 2026-10-08 as a goodwill allowance for a pre-revenue merchant, meant to be
  // revisited around 2026-12-08 (it does not expire by itself).
  reusableCodes: { "81xhhk-h2.myshopify.com": 5 },
  features: {},
};

// Matches "starter"/"pro" as whole words so private plans like "Multi-store
// Pro" map to the right tier, while names that merely contain the letters
// (e.g. "Professional") don't.
export function tierForPlanName(planName: string | null): PlanTier {
  if (!planName) return "Free";
  const words = planName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.includes(PLAN_PRO)) return "Pro";
  if (words.includes(PLAN_STARTER)) return "Starter";
  return "Free";
}

// Staging only: lets a test environment behave as a given plan, because the staging app has no
// Shopify App Pricing plans. Anything other than an exact tier name is ignored.
export function parseTierOverride(value: string | undefined): PlanTier | null {
  return value === "Free" || value === "Starter" || value === "Pro" ? value : null;
}

/** Active bulk codes allowed (null = unlimited). */
export function limitForTier(tier: PlanTier): number | null {
  return PLAN_LIMITS[tier].bulkCodes;
}

/** Reusable codes this shop may have at once, including any grandfathered allowance. */
export function reusableLimitFor(tier: PlanTier, shop: string): number | null {
  const base = PLAN_LIMITS[tier].reusableCodes;
  if (base === null) return null;
  return Math.max(base, GRANDFATHERED.reusableCodes[shop] ?? 0);
}

export function canUseFeature(
  tier: PlanTier,
  shop: string,
  feature: PlanFeature,
  locksEnabled: boolean = FEATURE_LOCKS_ENABLED
): boolean {
  if (!locksEnabled) return true;
  if (PLAN_LIMITS[tier].features[feature]) return true;
  return GRANDFATHERED.features[feature]?.includes(shop) ?? false;
}

/** Blocked product types this shop may have (null = unlimited). */
export function blockedTypeLimitFor(tier: PlanTier): number | null {
  return PLAN_LIMITS[tier].blockedProductTypes;
}

const FEATURE_NAMES: Record<PlanFeature, string> = {
  countryRestriction: "Country restrictions",
  discountCap: "A maximum discount per order",
  usesPerCustomer: "A limit on uses per customer",
  maxCartItems: "A maximum number of items in the cart",
};

export function featureName(feature: PlanFeature): string {
  return FEATURE_NAMES[feature];
}

/**
 * Whether saving should be refused because the shop is turning on a locked feature.
 * A feature that was already set stays editable, so nobody loses what they have.
 */
export function isFeatureBlocked(
  tier: PlanTier,
  shop: string,
  feature: PlanFeature,
  { isSet, wasSet }: { isSet: boolean; wasSet: boolean },
  locksEnabled: boolean = FEATURE_LOCKS_ENABLED
): boolean {
  return isSet && !wasSet && !canUseFeature(tier, shop, feature, locksEnabled);
}

export function featureBlockedMessage(feature: PlanFeature, tier: PlanTier): string {
  const plural = feature === "countryRestriction";
  return `${featureName(feature)} ${plural ? "are" : "is"} available on the Starter plan and above (you're on ${tier}). Upgrade on the Plans page to use ${plural ? "them" : "it"}.`;
}
