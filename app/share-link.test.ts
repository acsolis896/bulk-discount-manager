import { describe, test, expect } from "vitest";
import { buildDiscountLink, normalizeLandingPath } from "./share-link";

describe("buildDiscountLink", () => {
  test("code only", () => {
    expect(buildDiscountLink("https://shop.com", "SUMMER20")).toBe("https://shop.com/discount/SUMMER20");
  });

  test("ignores a trailing slash on the store URL", () => {
    expect(buildDiscountLink("https://shop.com/", "A")).toBe("https://shop.com/discount/A");
  });

  test("adds a landing page", () => {
    expect(buildDiscountLink("https://shop.com", "A", "/collections/sale")).toBe(
      "https://shop.com/discount/A?redirect=/collections/sale",
    );
  });

  test("encodes odd characters in the code and the landing path", () => {
    expect(buildDiscountLink("https://shop.com", "A B&C", "/products/x?variant=1")).toBe(
      "https://shop.com/discount/A%20B%26C?redirect=/products/x%3Fvariant%3D1",
    );
  });

  test("home page is the same as no landing page", () => {
    expect(buildDiscountLink("https://shop.com", "A", "/")).toBe("https://shop.com/discount/A");
  });
});

describe("normalizeLandingPath", () => {
  test("blank stays blank", () => {
    expect(normalizeLandingPath("   ")).toBe("");
  });

  test("adds the leading slash", () => {
    expect(normalizeLandingPath("products/hat")).toBe("/products/hat");
  });

  test("keeps only the path of a full URL", () => {
    expect(normalizeLandingPath("https://shop.com/collections/sale?sort=new")).toBe("/collections/sale?sort=new");
  });
});
