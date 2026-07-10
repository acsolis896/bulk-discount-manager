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
    select: { discountId: true, requiredTag: true, blockedTag: true, configJson: true, functionNodeId: true, blockedCustomerIds: true },
  });

  for (const code of singleCodes) {
    if (!code.configJson) continue;

    let baseConfig: Record<string, unknown> = {};
    try { baseConfig = JSON.parse(code.configJson); } catch { continue; }

    const hasRequiredTag = code.requiredTag ? customerTags.includes(code.requiredTag.toLowerCase()) : false;
    const hasBlockedTag = code.blockedTag ? customerTags.includes(code.blockedTag.toLowerCase()) : false;

    const blockedIds: string[] = code.blockedCustomerIds ? JSON.parse(code.blockedCustomerIds) : [];
    let blockedChanged = false;

    if (hasBlockedTag && !blockedIds.includes(customerId)) {
      blockedIds.push(customerId);
      blockedChanged = true;
    }
    if (!hasBlockedTag && blockedIds.includes(customerId)) {
      blockedIds.splice(blockedIds.indexOf(customerId), 1);
      blockedChanged = true;
    }

    // Update native customer selection for eligible list (no metafield node confusion)
    if (code.requiredTag) {
      const appId = code.discountId.replace("DiscountCodeNode", "DiscountCodeApp");
      const action = hasRequiredTag
        ? { customers: { add: [customerId], remove: [] as string[] } }
        : { customers: { remove: [customerId], add: [] as string[] } };
      await admin.graphql(
        `#graphql
        mutation UpdateCustomerSelection($id: ID!, $input: DiscountCodeAppInput!) {
          discountCodeAppUpdate(id: $id, codeAppDiscount: $input) {
            userErrors { field message }
          }
        }`,
        { variables: { id: appId, input: { customerSelection: { all: false, ...action } } } }
      );
    }

    // Update blockedCustomerIds in metafield if changed
    if (blockedChanged) {
      await db.singleCodeDiscount.updateMany({
        where: { shop: session.shop, discountId: code.discountId },
        data: { blockedCustomerIds: JSON.stringify(blockedIds) },
      });

      const metafieldConfig = JSON.stringify({ ...baseConfig, blockedCustomerIds: blockedIds });
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
  }

  return new Response();
};
