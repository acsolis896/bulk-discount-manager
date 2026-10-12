export interface CountryOption {
  code: string;
  name: string;
}

// Names people type that aren't the official one.
const ALIASES: Record<string, string[]> = {
  US: ["usa", "america", "united states of america"],
  GB: ["uk", "great britain", "britain", "england", "scotland", "wales"],
  AE: ["uae", "emirates"],
  KR: ["south korea"],
  KP: ["north korea"],
  CZ: ["czech republic"],
  MM: ["burma"],
  TR: ["turkey", "turkiye"],
  NL: ["holland"],
};

/** Lowercase, accents and punctuation removed, so "Côte d'Ivoire" matches "cote divoire". */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Countries matching what the merchant typed, best matches first: the start of the name, then the start
 * of a word in it, then anywhere in it, then a two-letter code or a common nickname ("UK", "USA").
 * Countries already chosen are left out.
 */
export function searchCountries(query: string, options: CountryOption[], chosenCodes: string[], limit = 8): CountryOption[] {
  const q = normalize(query);
  if (!q) return [];
  const chosen = new Set(chosenCodes);
  const scored: { option: CountryOption; rank: number }[] = [];
  for (const option of options) {
    if (chosen.has(option.code)) continue;
    const name = normalize(option.name);
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (name.split(" ").some((word) => word.startsWith(q))) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (option.code.toLowerCase() === q || (ALIASES[option.code] ?? []).some((alias) => normalize(alias).startsWith(q))) rank = 3;
    if (rank >= 0) scored.push({ option, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.option.name.localeCompare(b.option.name));
  return scored.slice(0, limit).map((s) => s.option);
}
