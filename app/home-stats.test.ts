import { describe, test, expect } from "vitest";
import { summarizeRedemptions, formatMoney } from "./home-stats";

const row = (orderId: string, code: string, totalPrice: number, currency = "USD") => ({ orderId, code, totalPrice, currency });

describe("summarizeRedemptions", () => {
  test("no orders", () => {
    expect(summarizeRedemptions([])).toEqual({ orders: 0, sales: [], topCode: null });
  });

  test("counts orders and adds up their totals", () => {
    const r = summarizeRedemptions([row("1", "A", 100), row("2", "A", 50.5), row("3", "B", 20)]);
    expect(r.orders).toBe(3);
    expect(r.sales).toEqual([{ currency: "USD", total: 170.5, orders: 3 }]);
    expect(r.topCode).toEqual({ code: "A", orders: 2 });
  });

  test("an order with two of the app's codes is counted once", () => {
    const r = summarizeRedemptions([row("1", "A", 100), row("1", "B", 100)]);
    expect(r.orders).toBe(1);
    expect(r.sales).toEqual([{ currency: "USD", total: 100, orders: 1 }]);
  });

  test("totals stay separate per currency, most orders first", () => {
    const r = summarizeRedemptions([row("1", "A", 10, "CAD"), row("2", "A", 20, "USD"), row("3", "A", 30, "USD")]);
    expect(r.sales.map((s) => s.currency)).toEqual(["USD", "CAD"]);
    expect(r.sales[0]).toEqual({ currency: "USD", total: 50, orders: 2 });
  });
});

describe("formatMoney", () => {
  test("formats known currencies", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
  });
  test("falls back for an unknown currency code", () => {
    expect(formatMoney(5, "not-a-currency")).toBe("5.00 not-a-currency");
  });
});
