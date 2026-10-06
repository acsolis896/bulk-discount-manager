import { describe, test, expect } from "vitest";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run.js";

const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
const P3 = "gid://shopify/Product/3";
const COLLECTION = "gid://shopify/Collection/10";
const manyCollections = Array.from({ length: 150 }, (_, i) => `gid://shopify/Collection/${1000 + i}`);

// lines: [{ product, inCollection }]. inCollection is what Shopify computes from
// inAnyCollection(ids: $collectionIds) in the input query.
function input({ lines, config }) {
  return {
    cart: {
      buyerIdentity: null,
      lines: lines.map(({ product, inCollection }, i) => ({
        id: `gid://shopify/CartLine/${i}`,
        quantity: 1,
        cost: { amountPerQuantity: { amount: "50" } },
        merchandise: { product: { id: product, productType: "", inAnyCollection: inCollection } },
      })),
    },
    enteredDiscountCodes: [{ code: "X-1", rejectable: false }],
    discount: { metafield: { value: JSON.stringify({ discountType: "percentage", percentage: 20, oncePerOrder: false, ...config }) } },
  };
}

const targetedLines = (result) =>
  result.operations[0]?.productDiscountsAdd?.candidates[0]?.targets.map((t) => t.cartLine.id) ?? [];

describe("collection-based eligibility (no stored product list)", () => {
  const config = { productIds: [], collectionIds: [COLLECTION], liveCollectionIds: [COLLECTION] };

  test("discounts only the products Shopify says are in the collection", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ config, lines: [{ product: P1, inCollection: true }, { product: P2, inCollection: false }, { product: P3, inCollection: true }] })
    );
    expect(targetedLines(result)).toEqual(["gid://shopify/CartLine/0", "gid://shopify/CartLine/2"]);
  });

  test("no product in the collection: no discount", () => {
    const result = cartLinesDiscountsGenerateRun(input({ config, lines: [{ product: P1, inCollection: false }] }));
    expect(result.operations).toEqual([]);
  });

  test("works when productIds is absent entirely", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ config: { liveCollectionIds: [COLLECTION] }, lines: [{ product: P1, inCollection: true }] })
    );
    expect(targetedLines(result)).toEqual(["gid://shopify/CartLine/0"]);
  });

  test("respects the max items cap on collection members", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({
        config: { ...config, maxDiscountedItems: 1 },
        lines: [{ product: P1, inCollection: true }, { product: P2, inCollection: true }],
      })
    );
    expect(targetedLines(result)).toEqual(["gid://shopify/CartLine/0"]);
  });
});

describe("stored product list still wins (existing discounts)", () => {
  test("a product list ignores live collection membership", () => {
    // An existing collection-based set stored every product in the collection plus its
    // collectionIds. It must keep using that list, so its behavior does not change.
    const config = { productIds: [P1], collectionIds: [COLLECTION], liveCollectionIds: [COLLECTION] };
    const result = cartLinesDiscountsGenerateRun(
      input({ config, lines: [{ product: P1, inCollection: false }, { product: P2, inCollection: true }] })
    );
    expect(targetedLines(result)).toEqual(["gid://shopify/CartLine/0"]);
  });

  test("a plain product-mode set is unaffected by the collection field", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ config: { productIds: [P2] }, lines: [{ product: P1, inCollection: true }, { product: P2, inCollection: false }] })
    );
    expect(targetedLines(result)).toEqual(["gid://shopify/CartLine/1"]);
  });
});

describe("nothing selected", () => {
  test("no product list and no collections: no discount", () => {
    const result = cartLinesDiscountsGenerateRun(input({ config: { productIds: [], collectionIds: [] }, lines: [{ product: P1, inCollection: true }] }));
    expect(result.operations).toEqual([]);
  });
});

describe("old configs and the 100-collection limit", () => {
  test("an old collection-mode config (stored product list, 150 collections) keeps using its list", () => {
    // This shape is what caused production errors: Shopify refuses to run the Function when a
    // list variable has over 100 entries. Only liveCollectionIds feeds the variable, so a long
    // collectionIds list in an old config is just data here and the stored list decides.
    const config = { productIds: [P1], collectionIds: manyCollections };
    const result = cartLinesDiscountsGenerateRun(
      input({ config, lines: [{ product: P1, inCollection: false }, { product: P2, inCollection: false }] })
    );
    expect(targetedLines(result)).toEqual(["gid://shopify/CartLine/0"]);
  });

  test("a config saved before liveCollectionIds existed (collectionIds only) applies nothing until re-saved", () => {
    const config = { productIds: [], collectionIds: [COLLECTION] };
    const result = cartLinesDiscountsGenerateRun(input({ config, lines: [{ product: P1, inCollection: true }] }));
    expect(result.operations).toEqual([]);
  });
});
