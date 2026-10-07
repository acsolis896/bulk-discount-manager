import { featureName, type PlanFeature } from "../billing";

/** Shown in place of a control that needs a paid plan. The server enforces the rule either way. */
export function UpgradeNote({ feature }: { feature: PlanFeature }) {
  const plural = feature === "countryRestriction";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
      <span style={{ flexShrink: 0, display: "inline-flex", paddingTop: "1px" }}>
        <s-icon type="info" />
      </span>
      <s-paragraph>
        {featureName(feature)} {plural ? "are" : "is"} available on the Starter plan and above.{" "}
        <s-link href="/app/plans">View plans</s-link>
      </s-paragraph>
    </div>
  );
}
