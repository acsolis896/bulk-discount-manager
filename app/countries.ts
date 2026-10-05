// ISO 3166-1 alpha-2 codes (plus XK, which Shopify uses for Kosovo).
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

const VALID_CODES = new Set(COUNTRY_CODES);

const displayNames = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;

export function countryName(code: string): string {
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export const COUNTRY_OPTIONS = COUNTRY_CODES
  .map((code) => ({ code, name: countryName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function parseAllowedCountries(raw: string): { countries: string[] } | { error: string } {
  if (!raw.trim()) return { countries: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Countries must be a list of valid country codes." };
  }
  if (!Array.isArray(parsed)) return { error: "Countries must be a list of valid country codes." };
  const countries: string[] = [];
  for (const item of parsed) {
    const code = String(item).trim().toUpperCase();
    if (!VALID_CODES.has(code)) return { error: `"${String(item)}" isn't a valid country code.` };
    if (!countries.includes(code)) countries.push(code);
  }
  return { countries };
}
