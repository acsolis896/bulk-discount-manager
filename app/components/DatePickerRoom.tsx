import { useRef, type ReactNode } from "react";

// About how tall the open calendar is, including a little margin.
const CALENDAR_HEIGHT = 340;

/**
 * Wraps a date field that sits at the bottom of a page. Its calendar opens downward and is cut off
 * when there isn't enough page below it. When the field gets focus this works out how much room is
 * missing, reports only that (the page adds blank space of that height under itself), and scrolls the
 * field toward the middle of the window so the calendar is visible. A field with enough room below
 * it gets no extra space.
 */
export function DatePickerRoom({ children, onSpaceChange }: { children: ReactNode; onSpaceChange: (px: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onFocus={() => {
        const el = ref.current;
        if (!el) return;
        const fieldBottom = el.getBoundingClientRect().bottom + window.scrollY;
        const roomBelow = document.documentElement.scrollHeight - fieldBottom;
        onSpaceChange(Math.max(0, Math.ceil(CALENDAR_HEIGHT - roomBelow)));
        requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "smooth" }));
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onSpaceChange(0);
      }}
    >
      {children}
    </div>
  );
}

/** Blank space under the page's last element while a date field is open, so the calendar isn't cut off. */
export function DatePickerSpace({ px }: { px: number }) {
  return px > 0 ? <div aria-hidden="true" style={{ height: `${px}px` }} /> : null;
}
