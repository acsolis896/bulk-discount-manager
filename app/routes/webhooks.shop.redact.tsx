import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Fires 48 hours after uninstall — purge anything still left for this shop.
  await db.session.deleteMany({ where: { shop } });
  await db.preUsedCode.deleteMany({ where: { shop } });
  await db.blockedProductType.deleteMany({ where: { shop } });
  await db.singleCodeDiscount.deleteMany({ where: { shop } });

  return new Response();
};
