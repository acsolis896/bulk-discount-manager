import { featureName, type PlanFeature } from "../billing";

/** Shown in place of a control that needs a paid plan. The server enforces the rule either way. */
export function UpgradeNote({ feature }: { feature: PlanFeature }) {
  const plural = feature === "countryRestriction";
  return (
    <s-paragraph>
      {featureName(feature)} {plural ? "are" : "is"} available on the Starter plan and above.{" "}
      <s-link href="/app/plans">View plans</s-link>
    </s-paragraph>
  );
}
