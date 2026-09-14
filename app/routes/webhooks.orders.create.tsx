import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

type OrderPayload = {
  discount_codes?: { code: string }[];
  customer?: { id: number } | null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, session } = await authenticate.webhook(request);

  if (!admin || !session) return new Response();

  const order = payload as OrderPayload;
  const discountCodes = order.discount_codes ?? [];
  const customerId = order.customer?.id;

  // Can't attribute usage to a specific customer without an account — nothing
  // to track for this order.
  if (!customerId || discountCodes.length === 0) return new Response();

  const customerGid = `gid://shopify/Customer/${customerId}`;

  for (const { code } of discountCodes) {
    const upperCode = code.toUpperCase();
    const row = await db.singleCodeDiscount.findFirst({
      where: { shop: session.shop, code: upperCode },
      select: {
        discountId: true,
        code: true,
        usesPerCustomerLimit: true,
        configJson: true,
        functionNodeId: true,
      },
    });
    if (!row || row.usesPerCustomerLimit == null) continue;

    const updated = await db.codeUsageCount.upsert({
      where: { shop_discountId_customerId: { shop: session.shop, discountId: row.discountId, customerId: customerGid } },
      create: { shop: session.shop, discountId: row.discountId, customerId: customerGid, count: 1 },
      update: { count: { increment: 1 } },
    });

    if (updated.count < row.usesPerCustomerLimit) continue;

    // Customer just hit their cap — add them to the usage-capped list the
    // Function checks, preserving every other key already in the config.
    let baseConfig: Record<string, unknown> = {};
    if (row.configJson) {
      try { baseConfig = JSON.parse(row.configJson); } catch { /* empty */ }
    } else {
      const readFromId = row.functionNodeId ?? row.discountId;
      const mfRes = await admin.graphql(
        `#graphql
        query GetMF($id: ID!) {
          discountNode(id: $id) {
            metafield(namespace: "$app", key: "function-configuration") { value }
          }
        }`,
        { variables: { id: readFromId } }
      );
      const mfData = await mfRes.json();
      try {
        const raw = mfData.data?.discountNode?.metafield?.value;
        if (raw) baseConfig = JSON.parse(raw);
      } catch { /* empty */ }
    }

    const existingCapped: string[] = Array.isArray(baseConfig.usageCappedCustomerIds)
      ? (baseConfig.usageCappedCustomerIds as string[])
      : [];
    if (existingCapped.includes(customerGid)) continue;

    const newConfig = { ...baseConfig, usageCappedCustomerIds: [...existingCapped, customerGid] };
    const configJson = JSON.stringify(newConfig);

    const writeTargets = [row.discountId];
    if (row.functionNodeId && row.functionNodeId !== row.discountId) writeTargets.push(row.functionNodeId);

    for (const ownerId of writeTargets) {
      await admin.graphql(
        `#graphql
        mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
        { variables: { metafields: [{ ownerId, namespace: "$app", key: "function-configuration", type: "json", value: configJson }] } }
      );
    }

    await db.singleCodeDiscount.updateMany({
      where: { shop: session.shop, discountId: row.discountId },
      data: { configJson },
    });
  }

  return new Response();
};
