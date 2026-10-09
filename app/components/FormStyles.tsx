/**
 * Makes the cards on a form stand out from the page: a light gray page background (like the
 * Shopify admin's own pages) and a soft shadow around each card. Applied while the form is shown.
 */
export function FormStyles() {
  return (
    <style>
      {`body { background-color: #f1f1f1; }
        s-section { box-shadow: 0 1px 0 rgba(26, 26, 26, 0.07), 0 2px 6px rgba(26, 26, 26, 0.12); border-radius: 12px; }`}
    </style>
  );
}
