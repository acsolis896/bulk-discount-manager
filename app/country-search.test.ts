import { describe, test, expect } from "vitest";
import { searchCountries } from "./country-search";
import { COUNTRY_OPTIONS } from "./countries";

const names = (query: string, chosen: string[] = []) => searchCountries(query, COUNTRY_OPTIONS, chosen).map((c) => c.name);

describe("searchCountries", () => {
  test("nothing typed, nothing suggested", () => {
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
  });

  test("starts-with matches come first", () => {
    const result = names("uni");
    expect(result.slice(0, 3)).toEqual(["United Arab Emirates", "United Kingdom", "United States"]);
  });

  test("typing the second word finds it", () => {
    expect(names("kingdom")).toContain("United Kingdom");
    expect(names("united k")).toEqual(["United Kingdom"]);
  });

  test("ignores case and accents", () => {
    expect(names("CANADA")).toEqual(["Canada"]);
    expect(names("cote")).toContain("Côte d’Ivoire");
  });

  test("two-letter codes and nicknames", () => {
    expect(names("uk")).toContain("United Kingdom");
    expect(names("usa")).toContain("United States");
    expect(names("uae")).toContain("United Arab Emirates");
  });

  test("leaves out countries already chosen", () => {
    expect(names("united k", ["GB"])).toEqual([]);
  });

  test("returns at most the limit", () => {
    expect(searchCountries("a", COUNTRY_OPTIONS, [], 5)).toHaveLength(5);
  });

  test("no match", () => {
    expect(names("zzzz")).toEqual([]);
  });
});
