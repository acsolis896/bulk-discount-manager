import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, session } = await authenticate.webhook(request);

  if (!admin || !session) return new Response();

  const customer = payload as { id: number };
  const customerId = `gid://shopify/Customer/${customer.id}`;

  // Tags are not included in the 2026-04 webhook payload — fetch them via Admin API
  const customerRes = await admin.graphql(
    `#graphql
    query GetCustomerTags($id: ID!) {
      customer(id: $id) { tags }
    }`,
    { variables: { id: customerId } }
  );
  const customerData = await customerRes.json();
  const customerTags: string[] = (customerData.data?.customer?.tags ?? []).map(
    (t: string) => t.trim().toLowerCase()
  );

  const singleCodes = await db.singleCodeDiscount.findMany({
    where: { shop: session.shop },
    select: { discountId: true, requiredTag: true, blockedTag: true },
  });

  for (const code of singleCodes) {
    const mfRes = await admin.graphql(
      `#graphql
      query GetMF($id: ID!) {
        discountNode(id: $id) {
          metafield(namespace: "$app", key: "function-configuration") { value }
        }
      }`,
      { variables: { id: code.discountId } }
    );
    const mfData = await mfRes.json();
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(mfData.data?.discountNode?.metafield?.value); } catch {}

    let eligibleIds: string[] = Array.isArray(config.eligibleCustomerIds)
      ? (config.eligibleCustomerIds as string[])
      : [];
    let blockedIds: string[] = Array.isArray(config.blockedCustomerIds)
      ? (config.blockedCustomerIds as string[])
      : [];

    let changed = false;

    if (code.requiredTag) {
      const hasTag = customerTags.includes(code.requiredTag.toLowerCase());
      if (hasTag && !eligibleIds.includes(customerId)) {
        eligibleIds = [...eligibleIds, customerId];
        changed = true;
      } else if (!hasTag && eligibleIds.includes(customerId)) {
        eligibleIds = eligibleIds.filter((id) => id !== customerId);
        changed = true;
      }
    }

    if (code.blockedTag) {
      const hasTag = customerTags.includes(code.blockedTag.toLowerCase());
      if (hasTag && !blockedIds.includes(customerId)) {
        blockedIds = [...blockedIds, customerId];
        changed = true;
      } else if (!hasTag && blockedIds.includes(customerId)) {
        blockedIds = blockedIds.filter((id) => id !== customerId);
        changed = true;
      }
    }

    if (!changed) continue;

    const newConfig = { ...config, eligibleCustomerIds: eligibleIds, blockedCustomerIds: blockedIds };

    await admin.graphql(
      `#graphql
      mutation UpdateDiscountMF($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [{
            ownerId: code.discountId,
            namespace: "$app",
            key: "function-configuration",
            type: "json",
            value: JSON.stringify(newConfig),
          }],
        },
      }
    );
  }

  return new Response();
};
