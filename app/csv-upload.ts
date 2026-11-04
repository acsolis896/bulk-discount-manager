/** A 5,000-code CSV is ~200 KB; this just stops a huge file being read into memory. */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

export const CSV_TOO_LARGE_ERROR = "That file is too large. Imports are limited to 5,000 codes.";
