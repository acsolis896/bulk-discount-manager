import { COUNTRY_OPTIONS, countryName } from "../countries";

export function CountryPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const available = COUNTRY_OPTIONS.filter((c) => !value.includes(c.code));

  return (
    <s-stack direction="block" gap="small">
      <s-select
        label="Only valid for shipping to these countries (optional)"
        placeholder="Add a country…"
        value=""
        details="Leave empty to allow any country. The code is checked against the shipping address at checkout, so it works for guests too."
        onChange={(e: { target: unknown }) => {
          const el = e.target as HTMLSelectElement;
          if (el.value) onChange([...value, el.value]);
          el.value = "";
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
