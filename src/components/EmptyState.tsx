/**
 * SKYLOG — a dignified empty state for the first ~minute while the
 * rolling buffer fills. Not a spinner: a sentence that tells the user
 * exactly what is happening.
 */

import { useSky } from "../state/store";
import { formatClock } from "../lib/units";

export function EmptyState(): JSX.Element {
  const status = useSky((s) => s.status);

  let line = "Waiting for first ADS-B contact in your radius.";
  if (status.kind === "polling") line = "Polling OpenSky Network…";
  if (status.kind === "offline") line = "Offline. Reconnecting…";
  if (status.kind === "rate_limited") {
    line = `OpenSky daily quota reached. Resumes at ${formatClock(status.until)}.`;
  }
  if (status.kind === "error") line = `Error: ${status.message}`;

  return (
    <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-ink-700 p-8 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-400">
        timeline
      </p>
      <p className="text-ink-300">{line}</p>
      <p className="max-w-md font-mono text-[10px] uppercase tracking-wider text-ink-500">
        planes appear as a bar on the strip at their time of closest approach.
        bar color maps to estimated ground-level dB.
      </p>
    </div>
  );
}
