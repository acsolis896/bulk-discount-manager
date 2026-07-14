import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export type EligibilityMode = "all" | "tags" | "segment";

/**
 * Finds a segment by name, or creates one, with a query matching the given
 * required/blocked customer tags. Returns null (with an error message) if
 * the mutation fails.
 */
export async function findOrCreateSegmentByTags(
  admin: AdminApiContext,
  segmentName: string,
  requiredTag: string,
  blockedTag: string
): Promise<{ segmentId: string | null; error?: string }> {
  const segmentQuery = blockedTag
    ? `customer_tags CONTAINS '${requiredTag}' AND customer_tags NOT CONTAINS '${blockedTag}'`
    : `customer_tags CONTAINS '${requiredTag}'`;

  const findRes = await admin.graphql(
    `#graphql
    query FindSegment($query: String!) {
      segments(first: 1, query: $query) {
        nodes { id name }
      }
    }`,
    { variables: { query: `name:'${segmentName}'` } }
  );
  const findData = await findRes.json();
  const existingSegment = findData.data?.segments?.nodes?.[0];

  if (existingSegment) {
    await admin.graphql(
      `#graphql
      mutation UpdateSegment($id: ID!, $name: String!, $query: String!) {
        segmentUpdate(id: $id, name: $name, query: $query) {
          userErrors { field message }
        }
      }`,
      { variables: { id: existingSegment.id, name: segmentName, query: segmentQuery } }
    );
    return { segmentId: existingSegment.id };
  }

  const createRes = await admin.graphql(
    `#graphql
    mutation CreateSegment($name: String!, $query: String!) {
      segmentCreate(name: $name, query: $query) {
        segment { id }
        userErrors { field message }
      }
    }`,
    { variables: { name: segmentName, query: segmentQuery } }
  );
  const createData = await createRes.json();
  const createErrors = createData.data?.segmentCreate?.userErrors ?? [];
  if (createErrors.length > 0) {
    return { segmentId: null, error: createErrors.map((e: { message: string }) => e.message).join(", ") };
  }
  return { segmentId: createData.data?.segmentCreate?.segment?.id ?? null };
}

/**
 * Assigns a customer segment as the sole eligibility criteria for a
 * DiscountCodeApp discount. appId must be the DiscountCodeApp GID (not the
 * DiscountCodeNode GID).
 */
export async function assignSegmentToDiscount(
  admin: AdminApiContext,
  appId: string,
  segmentId: string
): Promise<{ error?: string }> {
  // Reset first — discountCodeAppUpdate treats customerSelection as a full
  // replacement, but Shopify requires clearing "all" before adding segments.
  await admin.graphql(
    `#graphql
    mutation ResetCustomerSelection($id: ID!, $input: DiscountCodeAppInput!) {
      discountCodeAppUpdate(id: $id, codeAppDiscount: $input) {
        userErrors { field message }
      }
    }`,
    { variables: { id: appId, input: { customerSelection: { all: true } } } }
  );
  const res = await admin.graphql(
    `#graphql
    mutation SetCustomerSelection($id: ID!, $input: DiscountCodeAppInput!) {
      discountCodeAppUpdate(id: $id, codeAppDiscount: $input) {
        userErrors { field message }
      }
    }`,
    { variables: { id: appId, input: { customerSelection: { customerSegments: { add: [segmentId] } } } } }
  );
  const data = await res.json();
  const errors = data.data?.discountCodeAppUpdate?.userErrors ?? [];
  if (errors.length > 0) {
    return { error: errors.map((e: { message: string }) => e.message).join(", ") };
  }
  return {};
}

/**
 * Resolves eligibility mode + inputs into a segment ID and assigns it to the
 * discount. Returns an error string on failure, or null on success/no-op
 * (mode "all" is a no-op — new discounts default to all customers already).
 */
export async function applyEligibility(
  admin: AdminApiContext,
  nodeDiscountId: string,
  segmentName: string,
  mode: EligibilityMode,
  requiredTag: string,
  blockedTag: string,
  segmentId: string
): Promise<string | null> {
  if (mode === "all") return null;

  const appId = nodeDiscountId.replace("DiscountCodeNode", "DiscountCodeApp");

  if (mode === "tags") {
    if (!requiredTag) return null;
    const result = await findOrCreateSegmentByTags(admin, segmentName, requiredTag, blockedTag);
    if (result.error) return `Creating customer segment: ${result.error}`;
    if (!result.segmentId) return null;
    const assign = await assignSegmentToDiscount(admin, appId, result.segmentId);
    return assign.error ? `Assigning customer segment: ${assign.error}` : null;
  }

  // mode === "segment"
  if (!segmentId) return null;
  const assign = await assignSegmentToDiscount(admin, appId, segmentId);
  return assign.error ? `Assigning customer segment: ${assign.error}` : null;
}

export async function listSegments(admin: AdminApiContext): Promise<{ id: string; name: string }[]> {
  const res = await admin.graphql(
    `#graphql
    query ListSegments {
      segments(first: 250) {
        nodes { id name }
      }
    }`
  );
  const data = await res.json();
  return data.data?.segments?.nodes ?? [];
}
