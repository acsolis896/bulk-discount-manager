import { describe, test, expect } from "vitest";
import { parseIdList } from "./form-ids";

describe("parseIdList", () => {
  test("missing or empty means an empty list", () => {
    expect(parseIdList(null)).toEqual([]);
    expect(parseIdList("")).toEqual([]);
  });

  test("reads a JSON array of strings", () => {
    expect(parseIdList('["gid://shopify/Product/1","gid://shopify/Product/2"]')).toEqual([
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
    ]);
  });

  test("rejects malformed JSON", () => {
    expect(parseIdList("[oops")).toBeNull();
  });

  test("rejects anything that isn't an array of strings", () => {
    expect(parseIdList('{"a":1}')).toBeNull();
    expect(parseIdList("[1,2]")).toBeNull();
    expect(parseIdList("null")).toBeNull();
  });
});
