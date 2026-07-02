// export function cartValidationsGenerateRun(input: any) {

//   let hasGift = false;

//   for (const line of input.cart.lines) {
//     const tags = line.merchandise.product.hasTags;

//     if (tags && tags.length > 0 && tags[0].hasTag) {
//       hasGift = true;
//       break;
//     }
//   }

//   if (hasGift) {
//     return {
//       operations: [
//         {
//           validationAdd: {
//             errors: [
//               {
//                 message: "Free gifts cannot be combined with discount codes. Remove the gift to apply a discount code.",
//                 target: "cart"
//               }
//             ]
//           }
//         }
//       ]
//     };
//   }

//   return {
//     operations: []
//   };
// }

export function cartValidationsGenerateRun(_input: any) {
  // NOTE: The cart.validations.generate.run API does not expose enteredDiscountCodes
  // on the Cart type, so it's impossible to conditionally block checkout only when a
  // discount code is present. Blocking on GWP alone would prevent any customer with a
  // GWP item from checking out, even without a discount code.
  //
  // Discount code rejection is handled entirely by discount-rejection-function-js
  // (cart.lines.discounts.generate.run), which does have access to enteredDiscountCodes
  // and correctly rejects codes when a GWP product is in the cart.
  return {
    operations: []
  };
}