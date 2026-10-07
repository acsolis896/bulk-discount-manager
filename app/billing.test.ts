import { describe, test, expect } from "vitest";
import {
  PLAN_LIMITS,
  tierForPlanName,
  limitForTier,
  reusableLimitFor,
  canUseFeature,
  blockedTypeLimitFor,
  isFeatureBlocked,
  featureBlockedMessage,
  parseTierOverride,
} from "./billing";

const NEW_SHOP = "someone.myshopify.com";
const MAISON = "81xhhk-h2.myshopify.com";
const LOLITA = "htmybm-hw.myshopify.com";

describe("plan names map to tiers (unchanged)", () => {
  test.each([
    [null, "Free"],
    ["Starter", "Starter"],
    ["Pro", "Pro"],
    ["Multi-store Pro", "Pro"],
    ["Staging Pro", "Pro"],
    ["Professional", "Free"],
  ])("%s -> %s", (name, tier) => expect(tierForPlanName(name as string | null)).toBe(tier));
});

describe("limits per plan", () => {
  test("bulk codes", () => {
    expect(limitForTier("Free")).toBe(50);
    expect(limitForTier("Starter")).toBe(5000);
    expect(limitForTier("Pro")).toBeNull();
  });

  test("reusable codes", () => {
    expect(reusableLimitFor("Free", NEW_SHOP)).toBe(2);
    expect(reusableLimitFor("Starter", NEW_SHOP)).toBe(10);
    expect(reusableLimitFor("Pro", NEW_SHOP)).toBeNull();
  });

  test("blocked product types", () => {
    expect(blockedTypeLimitFor("Free")).toBe(1);
    expect(blockedTypeLimitFor("Starter")).toBe(5);
    expect(blockedTypeLimitFor("Pro")).toBeNull();
  });

  test("only Pro has priority support", () => {
    expect(PLAN_LIMITS.Free.prioritySupport).toBe(false);
    expect(PLAN_LIMITS.Starter.prioritySupport).toBe(false);
    expect(PLAN_LIMITS.Pro.prioritySupport).toBe(true);
  });
});

describe("features", () => {
  test("Free has none of the gated features; Starter and Pro have all of them", () => {
    for (const f of ["countryRestriction", "discountCap", "usesPerCustomer", "maxCartItems"] as const) {
      expect(canUseFeature("Free", NEW_SHOP, f)).toBe(false);
      expect(canUseFeature("Starter", NEW_SHOP, f)).toBe(true);
      expect(canUseFeature("Pro", NEW_SHOP, f)).toBe(true);
    }
  });
});

describe("grandfathering (existing merchants keep what they had)", () => {
  test("a shop with 3 reusable codes may keep 3 on Free, but a new Free shop gets 2", () => {
    expect(reusableLimitFor("Free", MAISON)).toBe(3);
    expect(reusableLimitFor("Free", NEW_SHOP)).toBe(2);
  });

  test("the allowance never lowers a paid plan's limit", () => {
    expect(reusableLimitFor("Starter", MAISON)).toBe(10);
    expect(reusableLimitFor("Pro", MAISON)).toBeNull();
  });

  test("no shop is currently allowed a gated feature on Free", () => {
    for (const f of ["countryRestriction", "discountCap", "usesPerCustomer", "maxCartItems"] as const) {
      expect(canUseFeature("Free", LOLITA, f)).toBe(false);
    }
  });
});

describe("saving a locked feature", () => {
  test("turning it on for the first time on Free is blocked", () => {
    expect(isFeatureBlocked("Free", NEW_SHOP, "countryRestriction", { isSet: true, wasSet: false })).toBe(true);
  });

  test("a feature that was already set can still be saved (nobody loses what they have)", () => {
    expect(isFeatureBlocked("Free", NEW_SHOP, "countryRestriction", { isSet: true, wasSet: true })).toBe(false);
  });

  test("not using the feature is never blocked", () => {
    expect(isFeatureBlocked("Free", NEW_SHOP, "discountCap", { isSet: false, wasSet: false })).toBe(false);
  });

  test("paid plans are never blocked", () => {
    expect(isFeatureBlocked("Starter", NEW_SHOP, "usesPerCustomer", { isSet: true, wasSet: false })).toBe(false);
  });

  test("the message names the feature and the plan", () => {
    expect(featureBlockedMessage("countryRestriction", "Free")).toContain("Country restrictions");
    expect(featureBlockedMessage("countryRestriction", "Free")).toContain("Starter");
    expect(featureBlockedMessage("usesPerCustomer", "Free")).toContain("is available");
    expect(featureBlockedMessage("maxCartItems", "Free")).toContain("maximum number of items");
    expect(featureBlockedMessage("discountCap", "Free")).toContain("per order is available");
    expect(featureBlockedMessage("countryRestriction", "Free")).toContain("are available");
  });
});

describe("staging plan override", () => {
  test("accepts only exact tier names", () => {
    expect(parseTierOverride("Pro")).toBe("Pro");
    expect(parseTierOverride("Starter")).toBe("Starter");
    expect(parseTierOverride("Free")).toBe("Free");
    for (const bad of ["pro", "PRO ", "", "Gold", undefined]) expect(parseTierOverride(bad as string | undefined)).toBeNull();
  });
});
