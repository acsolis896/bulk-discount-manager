import { useState, type KeyboardEvent } from "react";
import { COUNTRY_OPTIONS, countryName } from "../countries";
import { searchCountries } from "../country-search";

/**
 * Pick the countries a code is valid in: type part of a name, click a suggestion (or press Enter for the
 * top one) and it becomes a chip. This replaces a dropdown, where typing letters changed the selection
 * on every key and added several countries.
 */
export function CountryPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = searchCountries(query, COUNTRY_OPTIONS, value);
  const searching = query.trim().length > 0;

  const add = (code: string) => {
    if (!value.includes(code)) onChange([...value, code]);
    setQuery("");
    setActive(0);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" && matches.length > 0) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp" && matches.length > 0) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && matches.length > 0) {
      e.preventDefault();
      add(matches[Math.min(active, matches.length - 1)].code);
    } else if (e.key === "Escape") {
      setQuery("");
      setActive(0);
    }
  };

  return (
    <s-stack direction="block" gap="small">
      <div role="presentation" onKeyDown={handleKeyDown}>
      <s-text-field
        label="Only valid in these countries (optional)"
        placeholder="Search for a country…"
        value={query}
        details="Leave empty to allow any country. Checked against the country Shopify uses at checkout, which follows the shipping address, so it works for guests too. The code won't apply for shoppers in other countries."
        onInput={(e) => {
          setQuery((e.currentTarget as unknown as HTMLInputElement).value);
          setActive(0);
        }}
      />
      </div>
      {searching && (
        <div role="listbox" aria-label="Matching countries" style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
          {matches.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: "14px", color: "#6d7175" }}>No matching countries</div>
          ) : (
            matches.map((c, i) => (
              <button
                key={c.code}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => add(c.code)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: i === matches.length - 1 ? "none" : "1px solid #e1e3e5",
                  background: i === active ? "#f1f1f1" : "#fff",
                  font: "inherit",
                  fontSize: "14px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span>{c.name}</span>
                <span style={{ color: "#6d7175" }}>{c.code}</span>
              </button>
            ))
          )}
        </div>
      )}
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
