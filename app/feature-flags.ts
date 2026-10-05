// Set to false to hide the "Max items discounted" field. The cap itself is
// enforced by the deployed Function, so only enable it once that is live.
export const MAX_DISCOUNTED_ITEMS_ENABLED = true;

// Country restriction is enforced by the deployed Function. Keep this off until
// `shopify app deploy` has shipped the version that reads the shipping address.
export const COUNTRY_RESTRICTION_ENABLED = false;
