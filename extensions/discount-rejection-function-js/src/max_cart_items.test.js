import { describe, test, expect } from "vitest";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run.js";

const ELIGIBLE = "gid://shopify/Product/1";
const OTHER = "gid://shopify/Product/99";

// lines: [{ product, quantity }]
function input({ lines, config = {}, rejectable = false }) {
  return {
    cart: {
      buyerIdentity: null,
      lines: lines.map(({ product, quantity }, i) => ({
        id: `gid://shopify/CartLine/${i}`,
        quantity,
        cost: { amountPerQuantity: { amount: "50" } },
        merchandise: { product: { id: product, productType: "", inAnyCollection: false } },
      })),
    },
    enteredDiscountCodes: [{ code: "ONE-1", rejectable }],
    discount: {
      metafield: {
        value: JSON.stringify({ productIds: [ELIGIBLE], discountType: "percentage", percentage: 20, oncePerOrder: true, ...config }),
      },
    },
  };
}

const kinds = (result) => result.operations.map((op) => Object.keys(op)[0]);

describe("maxCartItems", () => {
  test("no limit configured: any cart size is fine", () => {
    expect(kinds(cartLinesDiscountsGenerateRun(input({ lines: [{ product: ELIGIBLE, quantity: 5 }] })))).toEqual(["productDiscountsAdd"]);
  });

  test("limit 1: a single unit applies", () => {
    const result = cartLinesDiscountsGenerateRun(input({ config: { maxCartItems: 1 }, lines: [{ product: ELIGIBLE, quantity: 1 }] }));
    expect(kinds(result)).toEqual(["productDiscountsAdd"]);
  });

  test("limit 1: two units of the same product are blocked (counts units, not products)", () => {
    const result = cartLinesDiscountsGenerateRun(input({ config: { maxCartItems: 1 }, lines: [{ product: ELIGIBLE, quantity: 2 }] }));
    expect(result.operations).toEqual([]);
  });

  test("limit 1: an eligible item plus an unrelated item is blocked (counts the whole cart)", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ config: { maxCartItems: 1 }, lines: [{ product: ELIGIBLE, quantity: 1 }, { product: OTHER, quantity: 1 }] })
    );
    expect(result.operations).toEqual([]);
  });

  test("limit 3: three units apply, four are blocked", () => {
    const three = cartLinesDiscountsGenerateRun(
      input({ config: { maxCartItems: 3 }, lines: [{ product: ELIGIBLE, quantity: 2 }, { product: OTHER, quantity: 1 }] })
    );
    const four = cartLinesDiscountsGenerateRun(
      input({ config: { maxCartItems: 3 }, lines: [{ product: ELIGIBLE, quantity: 2 }, { product: OTHER, quantity: 2 }] })
    );
    expect(kinds(three)).toEqual(["productDiscountsAdd"]);
    expect(four.operations).toEqual([]);
  });

  test("rejectable code over the limit: rejected with a singular message", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ rejectable: true, config: { maxCartItems: 1 }, lines: [{ product: ELIGIBLE, quantity: 2 }] })
    );
    expect(kinds(result)).toEqual(["enteredDiscountCodesReject"]);
    expect(result.operations[0].enteredDiscountCodesReject.message).toBe("This discount code is only valid for single-item orders.");
  });

  test("rejectable code over a larger limit: message names the limit", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ rejectable: true, config: { maxCartItems: 2 }, lines: [{ product: ELIGIBLE, quantity: 3 }] })
    );
    expect(result.operations[0].enteredDiscountCodesReject.message).toBe("This discount code is only valid for orders with 2 items or fewer.");
  });

  test.each([0, -1, 1.5, "1", null, undefined])("an invalid limit (%s) is ignored", (bad) => {
    const result = cartLinesDiscountsGenerateRun(input({ config: { maxCartItems: bad }, lines: [{ product: ELIGIBLE, quantity: 4 }] }));
    expect(kinds(result)).toEqual(["productDiscountsAdd"]);
  });
});
