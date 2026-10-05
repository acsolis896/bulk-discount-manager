import { describe, test, expect } from "vitest";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run.js";

const PRODUCT = "gid://shopify/Product/1";

// `country` is localization.country.isoCode; pass null to omit the field.
function input({ country, config = {}, rejectable = false } = {}) {
  return {
    cart: {
      buyerIdentity: null,
      lines: [
        {
          id: "gid://shopify/CartLine/0",
          quantity: 2,
          cost: { amountPerQuantity: { amount: "50" } },
          merchandise: { product: { id: PRODUCT, productType: "" } },
        },
      ],
    },
    ...(country ? { localization: { country: { isoCode: country } } } : {}),
    enteredDiscountCodes: [{ code: "USA-ABCD", rejectable }],
    discount: {
      metafield: {
        value: JSON.stringify({
          productIds: [PRODUCT],
          discountType: "percentage",
          percentage: 20,
          oncePerOrder: false,
          ...config,
        }),
      },
    },
  };
}

const kinds = (result) => result.operations.map((op) => Object.keys(op)[0]);

describe("country restriction", () => {
  test("no restriction configured: discount applies in any country", () => {
    expect(kinds(cartLinesDiscountsGenerateRun(input({ country: "CA" })))).toEqual(["productDiscountsAdd"]);
  });

  test("empty list means no restriction", () => {
    const result = cartLinesDiscountsGenerateRun(input({ country: "CA", config: { allowedCountries: [] } }));
    expect(kinds(result)).toEqual(["productDiscountsAdd"]);
  });

  test("allowed country: discount applies", () => {
    const result = cartLinesDiscountsGenerateRun(input({ country: "US", config: { allowedCountries: ["US"] } }));
    expect(kinds(result)).toEqual(["productDiscountsAdd"]);
  });

  test("one of several allowed countries: discount applies", () => {
    const result = cartLinesDiscountsGenerateRun(input({ country: "CA", config: { allowedCountries: ["US", "CA"] } }));
    expect(kinds(result)).toEqual(["productDiscountsAdd"]);
  });

  test("outside the list, own code (not rejectable): no discount", () => {
    const result = cartLinesDiscountsGenerateRun(input({ country: "CA", config: { allowedCountries: ["US"] } }));
    expect(result.operations).toEqual([]);
  });

  test("outside the list, rejectable code: rejected with a message", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ country: "CA", rejectable: true, config: { allowedCountries: ["US", "MX"] } })
    );
    expect(kinds(result)).toEqual(["enteredDiscountCodesReject"]);
    expect(result.operations[0].enteredDiscountCodesReject.codes).toEqual([{ code: "USA-ABCD" }]);
    expect(result.operations[0].enteredDiscountCodesReject.message).toContain("US, MX");
  });

  test("no country supplied: allowed", () => {
    const result = cartLinesDiscountsGenerateRun(input({ country: null, config: { allowedCountries: ["US"] } }));
    expect(kinds(result)).toEqual(["productDiscountsAdd"]);
  });
});
