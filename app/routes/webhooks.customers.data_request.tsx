import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logPersonalDataAccess } from "../access-log.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  await logPersonalDataAccess({ shop, action: "customers/data_request received", resourceType: "customer" });

  // This app does not store customer PII (name, email, address, etc). It only
  // stores Shopify customer GIDs (eligibility lists, per-customer usage counts)
  // and order-level references (order number, total, code used). No additional
  // data export is required beyond what Shopify itself provides to the customer.

  return new Response();
};
