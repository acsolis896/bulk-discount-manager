import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = (payload as { customer?: { id?: number } })?.customer?.id;
  if (!customerId) return new Response();
  const customerGid = `gid://shopify/Customer/${customerId}`;

  const codes = await db.singleCodeDiscount.findMany({
    where: { shop },
    select: {
      discountId: true,
      functionNodeId: true,
      configJson: true,
      eligibleCustomerIds: true,
      blockedCustomerIds: true,
    },
  });

  for (const code of codes) {
    const eligible: string[] = code.eligibleCustomerIds ? JSON.parse(code.eligibleCustomerIds) : [];
    const blocked: string[] = code.blockedCustomerIds ? JSON.parse(code.blockedCustomerIds) : [];

    const newEligible = eligible.filter((id) => id !== customerGid);
    const newBlocked = blocked.filter((id) => id !== customerGid);
    if (newEligible.length === eligible.length && newBlocked.length === blocked.length) continue;

    await db.singleCodeDiscount.updateMany({
      where: { shop, discountId: code.discountId },
      data: {
        eligibleCustomerIds: JSON.stringify(newEligible),
        blockedCustomerIds: JSON.stringify(newBlocked),
      },
    });

    // Best-effort: keep the live Shopify metafield in sync too. The shop may
    // already be uninstalled by the time this fires, in which case admin is
    // unavailable — the DB cleanup above is what matters for redaction.
    if (admin && code.configJson) {
      let baseConfig: Record<string, unknown> = {};
      try { baseConfig = JSON.parse(code.configJson); } catch { continue; }
      const writeTarget = code.functionNodeId ?? code.discountId;
      await admin.graphql(
        `#graphql
        mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
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
              value: JSON.stringify({ ...baseConfig, blockedCustomerIds: newBlocked }),
            }],
          },
        }
      );
    }
  }

  return new Response();
};
