/**
 * @typedef {import("../generated/api").InputQuery} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const metafieldValue = input.discount?.metafield?.value;
  if (!metafieldValue) return { operations: [] };

  let config;
  try {
    config = JSON.parse(metafieldValue);
  } catch {
    return { operations: [] };
  }

  const { productIds, percentage, blockedProductTypes } = config;
  const blocked = Array.isArray(blockedProductTypes) ? blockedProductTypes : ["GWP"];

  const hasBlockedType = input.cart.lines.some(
    (line) => blocked.includes(line.merchandise?.product?.productType)
  );

  if (hasBlockedType) {
    // Reject all rejectable entered discount codes so the code is removed
    // from the cart and the customer sees an error message
    const rejectableCodes = (input.enteredDiscountCodes ?? [])
      .filter((c) => c.rejectable)
      .map((c) => ({ code: c.code }));

    if (rejectableCodes.length > 0) {
      return {
        operations: [
          {
            enteredDiscountCodesReject: {
              codes: rejectableCodes,
              message: "This discount code can't be used when a gift item is in your cart.",
            },
          },
        ],
      };
    }
    return { operations: [] };
  }

  if (!Array.isArray(productIds) || productIds.length === 0 || !percentage) {
    return { operations: [] };
  }

  const numericIds = productIds.map((id) => id.split("/").pop());

  const eligibleLines = input.cart.lines.filter((line) => {
    const productId = line.merchandise?.product?.id;
    if (!productId) return false;
    return numericIds.includes(productId.split("/").pop());
  });

  if (eligibleLines.length === 0) return { operations: [] };

  const bestLine = eligibleLines.reduce((best, line) => {
    const price = parseFloat(line.cost.amountPerQuantity.amount);
    const bestPrice = parseFloat(best.cost.amountPerQuantity.amount);
    return price > bestPrice ? line : best;
  });

  const pct = Number(percentage);
  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: pct + "% off",
              targets: [{ cartLine: { id: bestLine.id, quantity: 1 } }],
              value: { percentage: { value: pct } },
            },
          ],
          selectionStrategy: "FIRST",
        },
      },
    ],
  };
}
