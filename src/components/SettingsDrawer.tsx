/**
 * SKYLOG — settings drawer.
 *
 * A bottom-anchored slide-up with radius, units, and a 24-hour CSV export.
 * Intentionally minimal — v0.1 has four toggles at most.
 */

import { useState } from "react";
import { useSky, selectPassesInWindow } from "../state/store";
import type { UnitSystem } from "../lib/units";

export function SettingsDrawer(): JSX.Element | null {
  const open = useSky((s) => s.settingsOpen);
  const setOpen = useSky((s) => s.setSettingsOpen);
  const units = useSky((s) => s.units);
  const setUnits = useSky((s) => s.setUnits);
  const radiusM = useSky((s) => s.radiusMeters);
  const setRadius = useSky((s) => s.setRadius);
  const resetHome = useSky((s) => s.resetHome);
  const passes = useSky((s) =>
    selectPassesInWindow(s, Date.now() - 24 * 60 * 60 * 1000, Date.now())
  );

  const [exporting, setExporting] = useState(false);

  if (!open) return null;

  const exportCsv = (): void => {
    setExporting(true);
    try {
      const header = [
        "passId",
        "icao24",
        "callsign",
        "origin_country",
        "first_seen_iso",
        "last_seen_iso",
        "closest_approach_iso",
        "min_slant_m",
        "closest_alt_m",
        "closest_ground_m",
        "peak_db",
      ];
      const rows = passes.map((p) => [
        p.passId,
        p.icao24,
        p.callsign ?? "",
        p.originCountry ?? "",
        new Date(p.firstSeen).toISOString(),
        new Date(p.lastSeen).toISOString(),
        new Date(p.closestApproachAt).toISOString(),
        p.minSlantM.toFixed(1),
        p.closestAltM?.toFixed(1) ?? "",
        p.closestGroundM.toFixed(1),
        p.peakDb.toFixed(1),
      ]);
      const lines = [header, ...rows]
        .map((r) =>
          r
            .map((v) => {
              const s = String(v);
              return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(",")
        )
        .join("\n");
      const blob = new Blob([lines], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `skylog-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-ink-950/60" onClick={() => setOpen(false)}>
      <div
        className="h-full w-full max-w-md border-l border-ink-700 bg-ink-900 p-6"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Settings</h3>
          <button
            onClick={() => setOpen(false)}
            className="font-mono text-xs text-ink-400 hover:text-accent"
          >
            ESC ×
          </button>
        </div>

        <section className="space-y-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            Radius
          </label>
          <input
            type="range"
            min={5_000}
            max={100_000}
            step={5_000}
            value={radiusM}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="font-mono tabular-nums text-sm">
            {(radiusM / 1000).toFixed(0)} km (
            {(radiusM / 1609.344).toFixed(1)} mi)
          </div>
          <p className="font-mono text-[10px] text-ink-500">
            Smaller radius = tighter bounding box & lower credit cost. 25 km
            covers the overhead cone for typical approach/departure routes.
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            Units
          </label>
          <div className="flex gap-2">
            {(["imperial", "metric"] as UnitSystem[]).map((u) => (
              <button
                key={u}
                onClick={() => setUnits(u)}
                className={`rounded border px-3 py-1 font-mono text-xs uppercase tracking-wider ${
                  units === u
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-ink-700 text-ink-300 hover:border-ink-500"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <label className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            Export
          </label>
          <button
            onClick={exportCsv}
            disabled={exporting || passes.length === 0}
            className="mt-2 block w-full rounded bg-accent px-4 py-2 text-center font-medium text-ink-950 disabled:opacity-30"
          >
            {exporting
              ? "Exporting…"
              : `Export last 24h (${passes.length} passes) as CSV`}
          </button>
        </section>

        <section className="mt-10 border-t border-ink-800 pt-4">
          <button
            onClick={() => {
              if (
                confirm(
                  "Reset home location and buffered passes? This cannot be undone."
                )
              ) {
                resetHome();
                setOpen(false);
              }
            }}
            className="font-mono text-xs text-ink-500 hover:text-accent"
          >
            Reset home & clear local buffer
          </button>
        </section>
      </div>
    </div>
  );
}
