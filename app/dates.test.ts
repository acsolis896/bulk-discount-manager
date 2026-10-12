import { describe, test, expect } from "vitest";
import { endOfDayIso, dateInZone, formatDateInZone } from "./dates";

describe("endOfDayIso", () => {
  test("the end of the day in New York (winter, UTC-5)", () => {
    expect(endOfDayIso("2026-12-31", "America/New_York")).toBe("2027-01-01T04:59:59.000Z");
  });

  test("the end of the day in New York (summer, UTC-4)", () => {
    expect(endOfDayIso("2026-07-15", "America/New_York")).toBe("2026-07-16T03:59:59.000Z");
  });

  test("a zone ahead of UTC (Sydney, UTC+11 in December)", () => {
    expect(endOfDayIso("2026-12-31", "Australia/Sydney")).toBe("2026-12-31T12:59:59.000Z");
  });

  test("UTC and unknown zones", () => {
    expect(endOfDayIso("2026-12-31", "UTC")).toBe("2026-12-31T23:59:59.000Z");
    expect(endOfDayIso("2026-12-31", "Not/AZone")).toBe("2026-12-31T23:59:59.000Z");
  });

  test("rejects text that isn't a date", () => {
    expect(endOfDayIso("", "UTC")).toBeNull();
    expect(endOfDayIso("12/31/2026", "UTC")).toBeNull();
  });
});

describe("reading the date back", () => {
  test("a date chosen in a store's zone comes back as the same date", () => {
    for (const zone of ["America/New_York", "America/Los_Angeles", "Australia/Sydney", "Asia/Dubai", "UTC"]) {
      const iso = endOfDayIso("2026-12-31", zone)!;
      expect(dateInZone(iso, zone)).toBe("2026-12-31");
      expect(formatDateInZone(iso, zone)).toBe("12/31/2026");
    }
  });
});
