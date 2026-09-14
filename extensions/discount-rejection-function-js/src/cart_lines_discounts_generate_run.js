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

  const { productIds, percentage, fixedAmount, discountType, oncePerOrder, blockedProductTypes, blockedCustomerIds, usageCappedCustomerIds } = config;

  const rejectableCodes = () =>
    (input.enteredDiscountCodes ?? []).filter((c) => c.rejectable).map((c) => ({ code: c.code }));

  // A customer tagged as blocked (via the Rules page) or who has hit a
  // per-customer usage cap on this reusable code is rejected outright,
  // before any cart contents are even considered.
  const buyerCustomerId = input.cart.buyerIdentity?.customer?.id ?? null;
  if (buyerCustomerId) {
    const isBlocked = Array.isArray(blockedCustomerIds) && blockedCustomerIds.includes(buyerCustomerId);
    const isUsageCapped = Array.isArray(usageCappedCustomerIds) && usageCappedCustomerIds.includes(buyerCustomerId);
    if (isBlocked || isUsageCapped) {
      const codes = rejectableCodes();
      if (codes.length > 0) {
        return {
          operations: [
            {
              enteredDiscountCodesReject: {
                codes,
                message: isUsageCapped
                  ? "This discount code has reached its usage limit for your account."
                  : "This discount code isn't available for your account.",
              },
            },
          ],
        };
      }
      return { operations: [] };
    }
  }

  const blocked = (Array.isArray(blockedProductTypes) ? blockedProductTypes : ["GWP"])
    .map((t) => (t ?? "").toUpperCase());

  const blockedLine = input.cart.lines.find((line) => {
    const productType = line.merchandise?.product?.productType;
    return productType != null && blocked.includes(productType.toUpperCase());
  });

  if (blockedLine) {
    const codes = rejectableCodes();
    if (codes.length > 0) {
      // Use the product's own casing (e.g. "Accessories") rather than the
      // stored ALL-CAPS value, so the message doesn't read as shouting.
      const matchedType = blockedLine.merchandise?.product?.productType;
      return {
        operations: [
          {
            enteredDiscountCodesReject: {
              codes,
              message: `This discount code can't be used with ${matchedType} items in your cart.`,
            },
          },
        ],
      };
    }
    return { operations: [] };
  }

  // "fixedAmount" is opt-in via discountType; absent/anything else defaults to
  // percentage to stay backward compatible with discounts created before this
  // field existed.
  const isFixedAmount = discountType === "fixedAmount";
  const hasValue = isFixedAmount ? Boolean(fixedAmount) : Boolean(percentage);

  if (!Array.isArray(productIds) || productIds.length === 0 || !hasValue) {
    return { operations: [] };
  }

  const numericIds = productIds.map((id) => id.split("/").pop());

  const eligibleLines = input.cart.lines.filter((line) => {
    const productId = line.merchandise?.product?.id;
    if (!productId) return false;
    return numericIds.includes(productId.split("/").pop());
  });

  if (eligibleLines.length === 0) return { operations: [] };

  // oncePerOrder is absent on discounts created before this field existed —
  // default to true so their behavior (highest-priced eligible item, 1 unit
  // only) doesn't change.
  const applyOncePerOrder = oncePerOrder !== false;

  let targets;
  if (applyOncePerOrder) {
    const bestLine = eligibleLines.reduce((best, line) => {
      const price = parseFloat(line.cost.amountPerQuantity.amount);
      const bestPrice = parseFloat(best.cost.amountPerQuantity.amount);
      return price > bestPrice ? line : best;
    });
    targets = [{ cartLine: { id: bestLine.id, quantity: 1 } }];
  } else {
    targets = eligibleLines.map((line) => ({ cartLine: { id: line.id } }));
  }

  const value = isFixedAmount
    ? { fixedAmount: { amount: Number(fixedAmount), appliesToEachItem: !applyOncePerOrder } }
    : { percentage: { value: Number(percentage) } };

  const message = isFixedAmount
    ? "$" + Number(fixedAmount) + " off"
    : Number(percentage) + "% off";

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [{ message, targets, value }],
          selectionStrategy: "FIRST",
        },
      },
    ],
  };
}
