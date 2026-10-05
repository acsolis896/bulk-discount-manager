import db from "./db.server";

// Records that the app handled customer data, never the data itself. Logging
// must never break the request that triggered it, so failures are swallowed.
export async function logPersonalDataAccess(entry: {
  shop: string;
  action: string;
  resourceType: string;
  customerId?: string | null;
}): Promise<void> {
  try {
    await db.personalDataAccessLog.create({
      data: {
        shop: entry.shop,
        action: entry.action,
        resourceType: entry.resourceType,
        customerId: entry.customerId ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to write personal data access log", error);
  }
}
