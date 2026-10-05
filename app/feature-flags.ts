import { useRouteLoaderData } from "react-router";

// Set to false to hide the "Max items discounted" field. The cap itself is
// enforced by the deployed Function, so only enable it once that is live.
export const MAX_DISCOUNTED_ITEMS_ENABLED = true;

// Country restriction is switched per environment with the COUNTRY_RESTRICTION_ENABLED
// variable ("true" shows the "Shipping countries" section and the "Valid for shipping to"
// detail line; unset or anything else hides them). The value comes from the app layout
// loader (app/routes/app.tsx). Leave it unset on production until the Function that
// enforces it (it reads the checkout country) is deployed there.
export function useCountryRestrictionEnabled(): boolean {
  const data = useRouteLoaderData("routes/app") as { countryRestriction?: boolean } | undefined;
  return data?.countryRestriction === true;
}
