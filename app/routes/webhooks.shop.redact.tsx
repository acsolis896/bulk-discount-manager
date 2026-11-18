import type { ActionFunctionArgs } from "react-router";
import { authenticateWebhookTolerant } from "../webhook-auth.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticateWebhookTolerant(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Fires 48 hours after uninstall — purge anything still left for this shop.
  try {
    await db.session.deleteMany({ where: { shop } });
    await db.preUsedCode.deleteMany({ where: { shop } });
    await db.blockedProductType.deleteMany({ where: { shop } });
    await db.singleCodeDiscount.deleteMany({ where: { shop } });
    await db.issuedCode.deleteMany({ where: { shop } });
    await db.codeUsageCount.deleteMany({ where: { shop } });
    await db.codeRedemption.deleteMany({ where: { shop } });
    await db.personalDataAccessLog.deleteMany({ where: { shop } });
  } catch (error) {
    console.error(`Failed to purge data for ${shop} on ${topic}`, error);
    throw error;
  }

  return new Response();
};
