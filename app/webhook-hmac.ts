import { createHmac, timingSafeEqual } from "node:crypto";

/** True when `header` is the base64 HMAC-SHA256 of `rawBody` signed with `secret`. */
export function isValidWebhookHmac(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let received: Buffer;
  try {
    received = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}
