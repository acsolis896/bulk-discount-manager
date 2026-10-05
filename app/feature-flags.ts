// Set to false to hide the "Max items discounted" field. The cap itself is
// enforced by the deployed Function, so only enable it once that is live.
export const MAX_DISCOUNTED_ITEMS_ENABLED = true;

// Off: Shopify's cart.lines.discounts.generate.run target never receives the shipping
// address (cart.deliveryGroups is always empty there), so the Function can't enforce
// the country restriction. Keep hidden until an approach that works is in place.
// Hides the "Shipping countries" section and the "Valid for shipping to" detail line.
export const COUNTRY_RESTRICTION_ENABLED = false;
