import { FormStyles } from "./FormStyles";

/**
 * Shown while a page loads. Uses the same gray background and card as the rest of the app, and the
 * three dots fade in turn so it looks like something is happening.
 */
export function LoadingPage() {
  return (
    <s-page heading="Loading">
      <FormStyles />
      <style>
        {`@keyframes bdm-loading-dot { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
          .bdm-loading-dot { animation: bdm-loading-dot 1.2s infinite ease-in-out; }
          .bdm-loading-dot:nth-child(2) { animation-delay: 0.2s; }
          .bdm-loading-dot:nth-child(3) { animation-delay: 0.4s; }
          @media (prefers-reduced-motion: reduce) { .bdm-loading-dot { animation: none; opacity: 0.6; } }`}
      </style>
      <s-section>
        <div role="status" aria-live="polite" style={{ fontSize: "16px", fontWeight: 600, padding: "8px 0" }}>
          Loading
          <span aria-hidden="true">
            <span className="bdm-loading-dot">.</span>
            <span className="bdm-loading-dot">.</span>
            <span className="bdm-loading-dot">.</span>
          </span>
        </div>
      </s-section>
    </s-page>
  );
}
