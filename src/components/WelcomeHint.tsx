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
      className="pointer-events-auto absolute bottom-3 right-3 z-20 hidden max-w-[22rem] rounded-md border border-ink-800 bg-ink-900/90 p-3 backdrop-blur md:block"
      role="status"
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
        welcome
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-200">
        Every orange triangle is a live aircraft, anywhere in the world. Click
        one for details. Pan or zoom — the feed follows the map. Skylog
        <em className="font-normal text-accent"> remembers every plane it sees</em>
        so when that 737 flies over tomorrow, it'll know. Press{" "}
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
        to set your home location, or{" "}
        <kbd className="rounded bg-ink-800 px-1 font-mono text-[10px] text-accent">
          m
        </kbd>{" "}
        to see planes Skylog already remembers.
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
