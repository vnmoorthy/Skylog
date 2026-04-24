/**
 * SKYLOG — one-click region presets.
 *
 * Quick jumps to the world's busiest air-traffic regions. The live feed
 * (airplanes.live) has best coverage in North America + Europe; the Asia
 * / Middle East / Oceania presets still work well. Africa and South
 * America are sparse — we surface them anyway so nobody feels excluded.
 */

import { useEffect, useRef, useState } from "react";

interface RegionPickerProps {
  onPick: (center: [number, number], zoom: number) => void;
}

interface Region {
  readonly name: string;
  readonly center: [number, number];
  readonly zoom: number;
}

const REGIONS: readonly Region[] = [
  { name: "Europe", center: [10, 50], zoom: 4.2 },
  { name: "North America", center: [-95, 40], zoom: 3.6 },
  { name: "East Asia", center: [120, 30], zoom: 4 },
  { name: "South Asia", center: [78, 22], zoom: 4 },
  { name: "Middle East", center: [47, 28], zoom: 4.6 },
  { name: "Oceania", center: [140, -25], zoom: 4 },
  { name: "South America", center: [-60, -20], zoom: 3.8 },
  { name: "Africa", center: [20, 5], zoom: 3.6 },
  { name: "Whole world", center: [5, 25], zoom: 2.2 },
];

export function RegionPicker({ onPick }: RegionPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
          open
            ? "bg-accent/20 text-accent"
            : "text-ink-300 hover:bg-ink-800/80 hover:text-ink-100"
        }`}
      >
        region ▾
      </button>
      {open && (
        <ul className="absolute right-0 z-50 mt-1 min-w-[180px] overflow-hidden rounded border border-ink-800 bg-ink-950/95 shadow-xl backdrop-blur">
          {REGIONS.map((r) => (
            <li key={r.name}>
              <button
                onClick={() => {
                  onPick(r.center, r.zoom);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] text-ink-200 hover:bg-accent/10 hover:text-accent"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
