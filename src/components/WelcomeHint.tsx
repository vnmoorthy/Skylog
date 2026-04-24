/**
 * SKYLOG — first-run welcome hint.
 *
 * Small dismissible toast shown the first time someone opens Skylog
 * (based on the persisted `onboarded` flag). Explains the controls
 * without blocking the map.
 */

import { useEffect, useState } from "react";
import { useSky } from "../state/store";

export function WelcomeHint(): JSX.Element | null {
  const onboarded = useSky((s) => s.onboarded);
  const markOnboarded = useSky((s) => s.markOnboarded);
  const [visible, setVisible] = useState<boolean>(!onboarded);

  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => {
      setVisible(false);
      markOnboarded();
    }, 14_000);
    return () => clearTimeout(t);
  }, [visible, markOnboarded]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-auto absolute bottom-4 right-4 z-20 max-w-[22rem] rounded-md border border-ink-800 bg-ink-900/90 p-3 backdrop-blur"
      role="status"
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
        welcome
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-200">
        Every orange triangle is a live aircraft. Click one for details.
        Pan or zoom anywhere — the feed follows the map. Press{" "}
        <kbd className="rounded bg-ink-800 px-1 font-mono text-[10px] text-accent">
          s
        </kbd>{" "}
        for satellites,{" "}
        <kbd className="rounded bg-ink-800 px-1 font-mono text-[10px] text-accent">
          l
        </kbd>{" "}
        for a list, or{" "}
        <kbd className="rounded bg-ink-800 px-1 font-mono text-[10px] text-accent">
          h
        </kbd>{" "}
        to set your home location.
      </p>
      <button
        onClick={() => {
          setVisible(false);
          markOnboarded();
        }}
        className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-500 hover:text-accent"
      >
        dismiss ×
      </button>
    </div>
  );
}
