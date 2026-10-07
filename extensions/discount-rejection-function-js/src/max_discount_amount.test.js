import { describe, test, expect } from "vitest";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run.js";

const P1 = "gid://shopify/Product/1";

// lines: [{ price, quantity }]; every line is an eligible product.
function input({ lines, config = {}, rate = "1.0" }) {
  return {
    cart: {
      buyerIdentity: null,
      lines: lines.map(({ price, quantity }, i) => ({
        id: `gid://shopify/CartLine/${i}`,
        quantity,
        cost: { amountPerQuantity: { amount: String(price) } },
        merchandise: { product: { id: P1, productType: "", inAnyCollection: false } },
      })),
    },
    presentmentCurrencyRate: rate,
    enteredDiscountCodes: [{ code: "HELLO10", rejectable: false }],
    discount: {
      metafield: {
        value: JSON.stringify({ productIds: [P1], discountType: "percentage", percentage: 10, oncePerOrder: false, ...config }),
      },
    },
  };
}

const candidate = (result) => result.operations[0].productDiscountsAdd.candidates[0];

describe("maxDiscountAmount (cap on a percentage discount)", () => {
  test("no cap configured: plain percentage", () => {
    const c = candidate(cartLinesDiscountsGenerateRun(input({ lines: [{ price: 5000, quantity: 1 }] })));
    expect(c.value).toEqual({ percentage: { value: 10 } });
  });

  test("percentage under the cap stays a percentage", () => {
    // 10% of 500 = 50, cap 100
    const c = candidate(cartLinesDiscountsGenerateRun(input({ config: { maxDiscountAmount: 100 }, lines: [{ price: 500, quantity: 1 }] })));
    expect(c.value).toEqual({ percentage: { value: 10 } });
    expect(c.message).toBe("10% off");
  });

  test("percentage exactly at the cap stays a percentage", () => {
    const c = candidate(cartLinesDiscountsGenerateRun(input({ config: { maxDiscountAmount: 100 }, lines: [{ price: 1000, quantity: 1 }] })));
    expect(c.value).toEqual({ percentage: { value: 10 } });
  });

  test("percentage over the cap becomes a flat amount equal to the cap", () => {
    // 10% of 1500 = 150, cap 100
    const c = candidate(cartLinesDiscountsGenerateRun(input({ config: { maxDiscountAmount: 100 }, lines: [{ price: 1500, quantity: 1 }] })));
    expect(c.value).toEqual({ fixedAmount: { amount: 100, appliesToEachItem: false } });
    expect(c.message).toBe("10% off (up to 100)");
  });

  test("the cap counts every targeted unit, not one line", () => {
    // 2 lines x 600 = 1200 -> 120 over the cap of 100
    const c = candidate(
      cartLinesDiscountsGenerateRun(input({ config: { maxDiscountAmount: 100 }, lines: [{ price: 600, quantity: 1 }, { price: 600, quantity: 1 }] }))
    );
    expect(c.value).toEqual({ fixedAmount: { amount: 100, appliesToEachItem: false } });
  });

  test("quantities count: 3 units x 400 = 1200", () => {
    const c = candidate(cartLinesDiscountsGenerateRun(input({ config: { maxDiscountAmount: 100 }, lines: [{ price: 400, quantity: 3 }] })));
    expect(c.value).toEqual({ fixedAmount: { amount: 100, appliesToEachItem: false } });
  });

  test("once per order only counts the one discounted unit", () => {
    // One unit of the 900 item is discounted: 90, under a cap of 100 even though the cart is bigger.
    const c = candidate(
      cartLinesDiscountsGenerateRun(
        input({ config: { maxDiscountAmount: 100, oncePerOrder: true }, lines: [{ price: 900, quantity: 1 }, { price: 800, quantity: 2 }] })
      )
    );
    expect(c.value).toEqual({ percentage: { value: 10 } });
  });

  test("max items discounted only counts the discounted units", () => {
    // 2 units of the 700 item get the discount: 140 over the cap; the cheaper line is not counted.
    const c = candidate(
      cartLinesDiscountsGenerateRun(
        input({ config: { maxDiscountAmount: 100, maxDiscountedItems: 2 }, lines: [{ price: 700, quantity: 2 }, { price: 50, quantity: 5 }] })
      )
    );
    expect(c.value).toEqual({ fixedAmount: { amount: 100, appliesToEachItem: false } });
  });

  test("the cap is converted to the checkout currency with the exchange rate", () => {
    // Shop cap 100, rate 3.6725 (e.g. USD -> AED): cap is 367.25 in the cart. 10% of 4000 = 400 > 367.25.
    const over = candidate(
      cartLinesDiscountsGenerateRun(input({ rate: "3.6725", config: { maxDiscountAmount: 100 }, lines: [{ price: 4000, quantity: 1 }] }))
    );
    expect(over.value).toEqual({ fixedAmount: { amount: 367.25, appliesToEachItem: false } });
    // 10% of 3000 = 300 < 367.25: still a percentage.
    const under = candidate(
      cartLinesDiscountsGenerateRun(input({ rate: "3.6725", config: { maxDiscountAmount: 100 }, lines: [{ price: 3000, quantity: 1 }] }))
    );
    expect(under.value).toEqual({ percentage: { value: 10 } });
  });

  test("a missing or invalid rate falls back to 1", () => {
    for (const rate of [undefined, "abc", "0", "-2"]) {
      const c = candidate(
        cartLinesDiscountsGenerateRun(input({ rate, config: { maxDiscountAmount: 100 }, lines: [{ price: 1500, quantity: 1 }] }))
      );
      expect(c.value).toEqual({ fixedAmount: { amount: 100, appliesToEachItem: false } });
    }
  });

  test("fixed amount discounts ignore the cap setting", () => {
    const c = candidate(
      cartLinesDiscountsGenerateRun(
        input({ config: { discountType: "fixedAmount", fixedAmount: 500, maxDiscountAmount: 100 }, lines: [{ price: 2000, quantity: 1 }] })
      )
    );
    // Existing behavior: with once-per-order off, a fixed amount applies to each targeted item.
    expect(c.value).toEqual({ fixedAmount: { amount: 500, appliesToEachItem: true } });
  });

  test.each([0, -5, "100", null, undefined, NaN])("an invalid cap (%s) is ignored", (bad) => {
    const c = candidate(cartLinesDiscountsGenerateRun(input({ config: { maxDiscountAmount: bad }, lines: [{ price: 5000, quantity: 1 }] })));
    expect(c.value).toEqual({ percentage: { value: 10 } });
  });
});
