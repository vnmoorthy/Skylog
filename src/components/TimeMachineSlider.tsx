/**
 * SKYLOG — time-machine bottom slider.
 *
 * Drag from 0 (now) backward to -10 minutes to replay the sky as it
 * looked. Plane markers warp to their nearest-time trail sample;
 * markers that didn't exist that long ago dim to near-invisible.
 *
 * Shown only when explicitly opened (key `r`). Pauses live polling
 * implicitly because the rAF loop ignores live positions during
 * replay.
 */

import { useEffect, useState } from "react";

interface TimeMachineSliderProps {
  open: boolean;
  offsetSec: number;
  onOffsetChange: (sec: number) => void;
  onClose: () => void;
}

const MAX_REPLAY_SEC = 600; // 10 minutes

export function TimeMachineSlider({
  open,
  offsetSec,
  onOffsetChange,
  onClose,
}: TimeMachineSliderProps): JSX.Element | null {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOffsetChange(0);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onOffsetChange]);

  // Auto-play: tick offset toward 0 every 200ms while playing.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      // Start over when we hit 0, stay paused at the live edge.
      const next = offsetSec - 5; // 5s real per 200ms = 25× speed
      if (next <= 0) {
        onOffsetChange(0);
        setPlaying(false);
      } else {
        onOffsetChange(next);
      }
    }, 200);
    return () => clearInterval(id);
  }, [playing, offsetSec, onOffsetChange]);

  if (!open) return null;

  const label =
    offsetSec === 0
      ? "live"
      : `−${Math.floor(offsetSec / 60)}:${String(offsetSec % 60).padStart(2, "0")} ago`;

  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-1/2 z-30 w-[min(600px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-md border border-accent/40 bg-ink-900/95 px-4 py-3 shadow-2xl backdrop-blur"
      role="region"
      aria-label="Time machine"
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-[9px] uppercase tracking-widest text-accent">
          time machine
        </span>
        <span className="ml-auto font-mono tabular-nums text-xs text-ink-100">
          {label}
        </span>
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause replay" : "Play replay"}
          className="rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300 hover:bg-ink-800 hover:text-ink-100"
        >
          {playing ? "pause" : "play ▶"}
        </button>
        <button
          onClick={() => {
            onOffsetChange(0);
            onClose();
          }}
          aria-label="Exit time machine"
          className="rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-400 hover:text-accent"
        >
          esc
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={MAX_REPLAY_SEC}
        step={5}
        value={offsetSec}
        onChange={(e) => onOffsetChange(MAX_REPLAY_SEC - Number(e.target.value))}
        // Visually: left = now, right = 10 min ago.
        // Internally we store the "ago" offset, so flip the value.
        className="mt-2 w-full accent-accent"
      />
      <p className="mt-1 font-mono text-[9px] text-ink-500">
        slide left for recent, right for older · drag to scrub the last 10 minutes
      </p>
    </div>
  );
}
