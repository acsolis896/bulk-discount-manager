/**
 * Title for a form card. The built-in section heading is small, which made the subheadings
 * inside the cards look as large as the cards themselves, so the card titles use their own size.
 */
export function CardTitle({ children }: { children: string }) {
  return (
    <div role="heading" aria-level={2} style={{ fontSize: "18px", fontWeight: 650, lineHeight: "24px", marginBottom: "16px" }}>
      {children}
    </div>
  );
}
