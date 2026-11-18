import { authenticate } from "./shopify.server";
import { isValidWebhookHmac } from "./webhook-hmac";

type SessionlessWebhook = {
  shop: string;
  topic: string;
  payload: unknown;
  admin: undefined;
  session: undefined;
};

/** Checks the webhook's signature and reads it, without looking up or refreshing the shop's token. */
async function authenticateWithoutSession(request: Request): Promise<SessionlessWebhook> {
  if (request.method !== "POST") throw new Response(undefined, { status: 405, statusText: "Method not allowed" });
  const rawBody = await request.text();
  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  if (!isValidWebhookHmac(rawBody, request.headers.get("x-shopify-hmac-sha256"), secret)) {
    throw new Response(undefined, { status: 401, statusText: "Unauthorized" });
  }
  const shop = request.headers.get("x-shopify-shop-domain");
  const topic = request.headers.get("x-shopify-topic");
  if (!shop || !topic) throw new Response(undefined, { status: 400, statusText: "Bad Request" });
  let payload: unknown = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Response(undefined, { status: 400, statusText: "Bad Request" });
  }
  return { shop, topic, payload, admin: undefined, session: undefined };
}

/**
 * Same as `authenticate.webhook`, for handlers that must also work for shops that have uninstalled.
 *
 * The standard check first tries to refresh the shop's stored access token, and Shopify refuses that
 * once the app is uninstalled, so the library answers with a silent 500 before our code runs. When
 * that happens, fall back to checking the signature alone: these handlers only need the shop and
 * payload (and use `admin` only when it is there).
 */
export async function authenticateWebhookTolerant(request: Request) {
  const copy = request.clone();
  try {
    return await authenticate.webhook(request);
  } catch (error) {
    if (error instanceof Response && error.status === 500) {
      console.warn("Webhook token refresh failed; checking the signature without a session");
      return authenticateWithoutSession(copy);
    }
    throw error;
  }
}
