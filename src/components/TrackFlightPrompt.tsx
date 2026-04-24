/**
 * SKYLOG — "Track a flight" modal.
 *
 * Opens from the TopBar. Asks for a callsign (or tail number), trims
 * it, and hands it back to App to spin up a FlightTracker.
 */

import { useEffect, useRef, useState } from "react";
import { normaliseCallsign } from "../lib/flightTracker";

interface TrackFlightPromptProps {
  onStart: (callsign: string) => void;
  onCancel: () => void;
}

export function TrackFlightPrompt({
  onStart,
  onCancel,
}: TrackFlightPromptProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = (): void => {
    const cs = normaliseCallsign(value);
    if (cs.length < 3) return;
    onStart(cs);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/70 px-6 pt-24 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-md border border-ink-700 bg-ink-900 p-6"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
          track a flight
        </p>
        <h2 className="mt-2 text-lg font-semibold text-ink-100">
          Paste a flight number or callsign
        </h2>
        <p className="mt-1 text-xs text-ink-400">
          Examples: <span className="font-mono text-ink-200">UAL841</span>,{" "}
          <span className="font-mono text-ink-200">BA286</span>,{" "}
          <span className="font-mono text-ink-200">SWA1234</span>. Skylog will
          pin this flight on the map and follow it globally until you stop.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="callsign"
            aria-label="Flight number or callsign"
            className="flex-1 rounded border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm uppercase tracking-wider text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
          />
          <button
            onClick={submit}
            className="rounded bg-accent px-4 py-2 font-medium text-ink-950 transition hover:bg-accent-soft disabled:opacity-30"
            disabled={normaliseCallsign(value).length < 3}
          >
            Track
          </button>
        </div>
        <p className="mt-3 font-mono text-[10px] text-ink-500">
          tip · most airline flight numbers need their 3-letter ICAO prefix (
          <span className="text-ink-300">UA123 → UAL123</span>).
        </p>
      </div>
    </div>
  );
}
