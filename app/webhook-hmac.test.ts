import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { isValidWebhookHmac } from "./webhook-hmac";

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body, "utf8").digest("base64");

describe("isValidWebhookHmac", () => {
  const body = JSON.stringify({ shop_id: 1, shop_domain: "x.myshopify.com" });

  it("accepts a correct signature", () => {
    expect(isValidWebhookHmac(body, sign(body, "secret"), "secret")).toBe(true);
  });

  it("rejects a signature made with another secret", () => {
    expect(isValidWebhookHmac(body, sign(body, "other"), "secret")).toBe(false);
  });

  it("rejects a changed body", () => {
    expect(isValidWebhookHmac(body + " ", sign(body, "secret"), "secret")).toBe(false);
  });

  it("rejects missing or malformed headers and an empty secret", () => {
    expect(isValidWebhookHmac(body, null, "secret")).toBe(false);
    expect(isValidWebhookHmac(body, "", "secret")).toBe(false);
    expect(isValidWebhookHmac(body, "not-a-signature", "secret")).toBe(false);
    expect(isValidWebhookHmac(body, sign(body, ""), "")).toBe(false);
  });
});
