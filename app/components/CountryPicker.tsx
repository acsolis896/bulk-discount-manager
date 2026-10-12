import { useEffect, useRef } from "react";
import { COUNTRY_OPTIONS, countryName } from "../countries";

// Typing letters into a closed dropdown changes its selection (and fires a change) on every key, so
// "United K" would add several countries. Changes that come from the keyboard wait a moment for the
// selection to settle and then add only the country it landed on. Clicking a country, or pressing Enter,
// adds it straight away.
const TYPING_SETTLE_MS = 300;
const KEY_WINDOW_MS = 150;

export function CountryPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const available = COUNTRY_OPTIONS.filter((c) => !value.includes(c.code));
  const valueRef = useRef(value);
  valueRef.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKey = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const commit = (el: HTMLSelectElement) => {
    const picked = el.value;
    if (picked && !valueRef.current.includes(picked)) onChange([...valueRef.current, picked]);
    el.value = "";
  };

  return (
    <s-stack direction="block" gap="small">
      <div role="presentation" onKeyDown={(e) => { lastKey.current = { key: e.key, at: Date.now() }; }}>
      <s-select
        label="Only valid in these countries (optional)"
        placeholder="Add a country…"
        value=""
        details="Leave empty to allow any country. Checked against the country Shopify uses at checkout, which follows the shipping address, so it works for guests too. The code won't apply for shoppers in other countries."
        onChange={(e: { target: unknown }) => {
          const el = e.target as HTMLSelectElement;
          if (timer.current) clearTimeout(timer.current);
          const { key, at } = lastKey.current;
          const typing = Date.now() - at < KEY_WINDOW_MS && key !== "Enter";
          if (typing) {
            timer.current = setTimeout(() => commit(el), TYPING_SETTLE_MS);
          } else {
            commit(el);
          }
        }}
      >
        {available.map((c) => (
          <s-option key={c.code} value={c.code}>{c.name}</s-option>
        ))}
      </s-select>
      </div>
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
