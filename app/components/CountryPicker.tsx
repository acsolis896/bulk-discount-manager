import { useEffect, useRef } from "react";
import { COUNTRY_OPTIONS, countryName } from "../countries";

// Typing letters into a closed dropdown changes its selection (and fires a change) on every key, so
// "United K" would add several countries. Wait until the selection has been still for a moment, then
// add only the one it landed on.
const COMMIT_DELAY_MS = 600;

export function CountryPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const available = COUNTRY_OPTIONS.filter((c) => !value.includes(c.code));
  const valueRef = useRef(value);
  valueRef.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <s-stack direction="block" gap="small">
      <s-select
        label="Only valid in these countries (optional)"
        placeholder="Add a country…"
        value=""
        details="Leave empty to allow any country. Checked against the country Shopify uses at checkout, which follows the shipping address, so it works for guests too. The code won't apply for shoppers in other countries."
        onChange={(e: { target: unknown }) => {
          const el = e.target as HTMLSelectElement;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const picked = el.value;
            if (picked && !valueRef.current.includes(picked)) onChange([...valueRef.current, picked]);
            el.value = "";
          }, COMMIT_DELAY_MS);
        }}
      >
        {available.map((c) => (
          <s-option key={c.code} value={c.code}>{c.name}</s-option>
        ))}
      </s-select>
      {value.length > 0 && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {value.map((code) => (
            <s-clickable-chip key={code} removable onRemove={() => onChange(value.filter((c) => c !== code))}>
              {countryName(code)}
            </s-clickable-chip>
          ))}
        </div>
      )}
    </s-stack>
  );
}
