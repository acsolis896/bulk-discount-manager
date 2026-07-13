import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // This app does not store customer PII (name, email, address, etc).
  // It only stores Shopify customer GIDs, referenced for discount eligibility
  // (Single Codes required/blocked tag lists). No additional data export is
  // required beyond what Shopify itself provides to the customer.

  return new Response();
};
