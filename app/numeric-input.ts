// Shopify's text/number web components don't reliably block non-numeric
// characters, so clean the value as it's typed and write it back to the
// element (React state alone won't redraw the box if the cleaned value is
// unchanged, e.g. typing a letter).
export function numericInputHandler(kind: "integer" | "decimal", set: (value: string) => void) {
  return (e: { target: unknown }) => {
    const el = e.target as HTMLInputElement;
    let clean: string;
    if (kind === "integer") {
      clean = el.value.replace(/\D/g, "");
    } else {
      const raw = el.value.replace(/[^\d.]/g, "");
      const dot = raw.indexOf(".");
      clean = dot === -1 ? raw : raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, "").slice(0, 2);
    }
    if (el.value !== clean) el.value = clean;
    set(clean);
  };
}
