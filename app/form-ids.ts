/** A list of IDs submitted as JSON in a form field; null if it isn't a JSON array of strings. */
export function parseIdList(raw: FormDataEntryValue | null): string[] | null {
  try {
    const value: unknown = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) return null;
    return value;
  } catch {
    return null;
  }
}

export const BAD_FORM_ERROR = "Something went wrong with the form. Please reload the page and try again.";
