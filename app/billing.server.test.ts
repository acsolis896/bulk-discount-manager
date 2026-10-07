import { describe, test, expect, vi, beforeEach } from "vitest";

// A fake database: the shop's reusable codes live in `rows`.
let rows: { shop: string; discountId: string }[] = [];
vi.mock("./db.server", () => ({
  default: {
    singleCodeDiscount: {
      findMany: vi.fn(async ({ where }: { where: { shop: string } }) => rows.filter((r) => r.shop === where.shop)),
      count: vi.fn(async ({ where }: { where: { shop: string } }) => rows.filter((r) => r.shop === where.shop).length),
      deleteMany: vi.fn(async ({ where }: { where: { shop: string; discountId: { in: string[] } } }) => {
        rows = rows.filter((r) => !(r.shop === where.shop && where.discountId.in.includes(r.discountId)));
        return { count: 0 };
      }),
    },
  },
}));

import { checkReusableQuota, checkCodeQuota, getCurrentPlan } from "./billing.server";

const SHOP = "test.myshopify.com";
const MAISON = "81xhhk-h2.myshopify.com";

const billingFor = (planName: string | null) => ({
  check: async () => ({ appSubscriptions: planName ? [{ id: "1", name: planName, status: "ACTIVE" }] : [] }),
});
const node = (n: number) => `gid://shopify/DiscountCodeNode/${n}`;
const seed = (shop: string, n: number) => {
  rows = Array.from({ length: n }, (_, i) => ({ shop, discountId: node(i + 1) }));
};

// A fake Shopify admin. `existing` are the discount node ids that still exist; `bulkNodes` feed the bulk count.
function fakeAdmin({ existing, bulkNodes = [], failNodes = false }: { existing?: string[]; bulkNodes?: unknown[]; failNodes?: boolean } = {}) {
  return {
    graphql: vi.fn(async (query: string, opts?: { variables?: { ids?: string[] } }) => ({
      json: async () => {
        if (query.includes("ReusableCodeNodes")) {
          if (failNodes) return { errors: [{ message: "boom" }] };
          return { data: { nodes: (opts?.variables?.ids ?? []).map((id) => (existing?.includes(id) ? { id } : null)) } };
        }
        return { data: { discountNodes: { nodes: bulkNodes, pageInfo: { hasNextPage: false } } } };
      },
    })),
  } as never;
}

beforeEach(() => {
  rows = [];
  delete process.env.PLAN_TIER_OVERRIDE;
});

describe("reusable code limit", () => {
  test("Free: under the limit is allowed", async () => {
    seed(SHOP, 1);
    const r = await checkReusableQuota(fakeAdmin(), billingFor(null), SHOP);
    expect(r).toMatchObject({ allowed: true, tier: "Free", limit: 2, current: 1 });
  });

  test("Free: at the limit is refused (and nothing deleted when all still exist)", async () => {
    seed(SHOP, 2);
    const r = await checkReusableQuota(fakeAdmin({ existing: [node(1), node(2)] }), billingFor(null), SHOP);
    expect(r).toMatchObject({ allowed: false, limit: 2, current: 2 });
    expect(rows).toHaveLength(2);
  });

  test("a code deleted in the Shopify admin stops counting, so the merchant isn't wrongly blocked", async () => {
    seed(SHOP, 2);
    const r = await checkReusableQuota(fakeAdmin({ existing: [node(1)] }), billingFor(null), SHOP);
    expect(r).toMatchObject({ allowed: true, current: 1 });
    expect(rows.map((x) => x.discountId)).toEqual([node(1)]);
  });

  test("if Shopify can't be asked, nothing is removed and the limit holds", async () => {
    seed(SHOP, 2);
    const r = await checkReusableQuota(fakeAdmin({ failNodes: true }), billingFor(null), SHOP);
    expect(r).toMatchObject({ allowed: false, current: 2 });
    expect(rows).toHaveLength(2);
  });

  test("Starter allows up to 10", async () => {
    seed(SHOP, 9);
    expect((await checkReusableQuota(fakeAdmin({ existing: rows.map((x) => x.discountId) }), billingFor("Starter"), SHOP)).allowed).toBe(true);
    seed(SHOP, 10);
    expect((await checkReusableQuota(fakeAdmin({ existing: rows.map((x) => x.discountId) }), billingFor("Starter"), SHOP)).allowed).toBe(false);
  });

  test("Pro is unlimited and never touches the database", async () => {
    seed(SHOP, 500);
    const r = await checkReusableQuota(fakeAdmin(), billingFor("Pro"), SHOP);
    expect(r).toMatchObject({ allowed: true, limit: null });
  });

  test("a grandfathered shop keeps its 3 on Free but cannot add a 4th", async () => {
    seed(MAISON, 3);
    const r = await checkReusableQuota(fakeAdmin({ existing: rows.map((x) => x.discountId) }), billingFor(null), MAISON);
    expect(r).toMatchObject({ allowed: false, limit: 3, current: 3 });
  });
});

describe("bulk code limit", () => {
  const bulkNode = (id: string, unused: number, used: number) => ({
    id,
    discount: {
      __typename: "DiscountCodeApp",
      codes: { nodes: [...Array(unused).fill({ asyncUsageCount: 0 }), ...Array(used).fill({ asyncUsageCount: 3 })] },
    },
  });

  test("counts unused bulk codes and refuses a request that would pass the limit", async () => {
    const admin = fakeAdmin({ bulkNodes: [bulkNode(node(900), 40, 10)] });
    expect(await checkCodeQuota(admin, billingFor(null), SHOP, 10)).toMatchObject({ allowed: true, limit: 50, current: 40 });
    expect(await checkCodeQuota(admin, billingFor(null), SHOP, 11)).toMatchObject({ allowed: false });
  });

  test("reusable codes are not counted against the bulk limit", async () => {
    seed(SHOP, 1); // node(1) is a reusable code
    const admin = fakeAdmin({ bulkNodes: [bulkNode(node(1), 1, 0), bulkNode(node(900), 30, 0)] });
    expect(await checkCodeQuota(admin, billingFor(null), SHOP, 20)).toMatchObject({ allowed: true, current: 30 });
  });

  test("Pro is unlimited", async () => {
    expect(await checkCodeQuota(fakeAdmin(), billingFor("Pro"), SHOP, 100000)).toMatchObject({ allowed: true, limit: null });
  });
});

describe("staging plan override", () => {
  test("acts as the chosen plan and ignores the Shopify subscription", async () => {
    process.env.PLAN_TIER_OVERRIDE = "Pro";
    const plan = await getCurrentPlan(billingFor(null));
    expect(plan).toMatchObject({ tier: "Pro", limit: null });
  });

  test("an invalid value is ignored", async () => {
    process.env.PLAN_TIER_OVERRIDE = "gold";
    expect((await getCurrentPlan(billingFor("Starter"))).tier).toBe("Starter");
  });
});
