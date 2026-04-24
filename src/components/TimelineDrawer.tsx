/**
 * SKYLOG — bottom drawer that hosts the historical pass timeline.
 *
 * The timeline view is valuable once the user has set a home and
 * accumulated passes, but unhelpful as a first screen. We put it in a
 * drawer triggered from the top bar.
 */

import { useEffect } from "react";
import { Timeline, LoudnessLegend } from "./Timeline";
import { EmptyState } from "./EmptyState";
import { useSky } from "../state/store";

interface TimelineDrawerProps {
  onClose: () => void;
}

export function TimelineDrawer({ onClose }: TimelineDrawerProps): JSX.Element {
  const passCount = useSky((s) => Object.keys(s.passes).length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 max-h-[60vh] overflow-hidden border-t border-ink-800 bg-ink-950/95 backdrop-blur"
      role="dialog"
      aria-label="Pass timeline"
    >
      <header className="flex items-center justify-between border-b border-ink-800 px-6 py-3">
        <div className="flex items-baseline gap-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-100">
            timeline · last 24 hours
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            {passCount} pass{passCount === 1 ? "" : "es"}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <LoudnessLegend />
          <button
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-wider text-ink-300 hover:text-accent"
          >
            esc ×
          </button>
        </div>
      </header>
      <div className="overflow-x-auto p-4">
        {passCount === 0 ? <EmptyState /> : <Timeline />}
      </div>
    </div>
  );
}
