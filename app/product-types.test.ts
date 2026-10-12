import { describe, test, expect } from "vitest";
import { pickableProductTypes } from "./product-types";

describe("pickableProductTypes", () => {
  test("sorts the store's types and drops blanks", () => {
    expect(pickableProductTypes(["Shoes", "", "Accessories", "  "], [])).toEqual(["Accessories", "Shoes"]);
  });

  test("leaves out types that are already blocked, ignoring case", () => {
    expect(pickableProductTypes(["Accessories", "GWP", "Shoes"], ["gwp"])).toEqual(["Accessories", "Shoes"]);
  });

  test("removes repeats that differ only by case", () => {
    expect(pickableProductTypes(["Shoes", "shoes", "SHOES"], [])).toEqual(["Shoes"]);
  });

  test("is empty when the store has no product types", () => {
    expect(pickableProductTypes([], [])).toEqual([]);
  });
});
