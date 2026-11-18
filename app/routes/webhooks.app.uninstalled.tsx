import type { ActionFunctionArgs } from "react-router";
import { authenticateWebhookTolerant } from "../webhook-auth.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticateWebhookTolerant(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled,
  // so deleting is always safe even when the session is already gone.
  try {
    await db.session.deleteMany({ where: { shop } });

    // Clean up all shop data on uninstall
    await db.preUsedCode.deleteMany({ where: { shop } });
    await db.blockedProductType.deleteMany({ where: { shop } });
    await db.singleCodeDiscount.deleteMany({ where: { shop } });
  } catch (error) {
    console.error(`Failed to clean up data for ${shop} on ${topic}`, error);
    throw error;
  }

  return new Response();
};
