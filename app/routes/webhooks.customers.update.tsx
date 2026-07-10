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

  // Customer eligibility (requiredTag whitelist) is handled by a dynamic customer segment
  // assigned to the discount — no action needed here for the eligible list.
  // We only update blockedCustomerIds in the function metafield as a backup check.

  const codes = await db.singleCodeDiscount.findMany({
    where: { shop: session.shop },
    select: { discountId: true, blockedTag: true, configJson: true, functionNodeId: true, blockedCustomerIds: true },
  });

  for (const code of codes) {
    if (!code.configJson || !code.blockedTag) continue;

    const blocked: string[] = code.blockedCustomerIds ? JSON.parse(code.blockedCustomerIds) : [];
    const hasBlockedTag = customerTags.includes(code.blockedTag.toLowerCase());

    let changed = false;
    if (hasBlockedTag && !blocked.includes(customerId)) {
      blocked.push(customerId);
      changed = true;
    } else if (!hasBlockedTag && blocked.includes(customerId)) {
      blocked.splice(blocked.indexOf(customerId), 1);
      changed = true;
    }

    if (!changed) continue;

    let baseConfig: Record<string, unknown> = {};
    try { baseConfig = JSON.parse(code.configJson); } catch { continue; }

    await db.singleCodeDiscount.updateMany({
      where: { shop: session.shop, discountId: code.discountId },
      data: { blockedCustomerIds: JSON.stringify(blocked) },
    });

    const metafieldConfig = JSON.stringify({ ...baseConfig, blockedCustomerIds: blocked });
    const writeTarget = code.functionNodeId ?? code.discountId;
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
            ownerId: writeTarget,
            namespace: "$app",
            key: "function-configuration",
            type: "json",
            value: metafieldConfig,
          }],
        },
      }
    );
  }

  return new Response();
};
