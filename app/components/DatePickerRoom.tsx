import { useRef, type ReactNode } from "react";

/**
 * Wraps a date field that sits at the bottom of a page. Its calendar opens downward and gets cut off
 * when there's no page below it, so this reports when the field has focus (the page adds blank room
 * under itself while that's true) and scrolls the field into view.
 */
export function DatePickerRoom({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onFocus={() => {
        onOpenChange(true);
        requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onOpenChange(false);
      }}
    >
      {children}
    </div>
  );
}

/** Blank space under the page's last element while a date field is open, so the calendar isn't cut off. */
export function DatePickerSpace({ open }: { open: boolean }) {
  return open ? <div aria-hidden="true" style={{ height: "380px" }} /> : null;
}
