// Expiration dates are picked as a calendar date ("2026-12-31") but Shopify stores a moment in time.
// Turning the date into midnight UTC and showing it in each viewer's own time zone is what shifted dates
// by a day, so a date is always read and shown in the store's own time zone, and "expires on the 31st"
// means the end of the 31st there.

/** How far a time zone is ahead of UTC at the given moment, in milliseconds. */
function zoneOffsetMs(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asIfUtc - Math.floor(timestamp / 1000) * 1000;
}

function isValidZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "2026-12-31" in a time zone -> the ISO moment that day ends (23:59:59 there). Null if the date isn't valid. */
export function endOfDayIso(dateText: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  if (!m) return null;
  const zone = isValidZone(timeZone) ? timeZone : "UTC";
  const wallClockAsUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  if (Number.isNaN(wallClockAsUtc)) return null;
  // The offset can differ at the real moment (daylight saving), so settle it in two passes.
  let result = wallClockAsUtc - zoneOffsetMs(wallClockAsUtc, zone);
  result = wallClockAsUtc - zoneOffsetMs(result, zone);
  return new Date(result).toISOString();
}

/** An ISO moment -> the calendar date ("2026-12-31") it falls on in the time zone. */
export function dateInZone(iso: string, timeZone: string): string {
  const zone = isValidZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** An ISO moment -> "12/31/2026", the date in the time zone. */
export function formatDateInZone(iso: string, timeZone: string): string {
  const zone = isValidZone(timeZone) ? timeZone : "UTC";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: zone });
}

/** An ISO moment -> "Dec 31, 2026", the date in the time zone. */
export function formatMediumDateInZone(iso: string, timeZone: string): string {
  const zone = isValidZone(timeZone) ? timeZone : "UTC";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone });
}
