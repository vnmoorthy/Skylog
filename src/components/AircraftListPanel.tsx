/**
 * SKYLOG — right-side scrollable aircraft list.
 *
 * Small, defaults to collapsed. Used by plane-spotters who want to see
 * every flight in view rather than click the map. Includes a search
 * field (filters by callsign / icao24) and a sort toggle (alt ↑ / ↓,
 * callsign, distance from home).
 */

import { useMemo, useState } from "react";
import type { StateVector } from "../lib/opensky";
import { haversineMeters, type LatLon } from "../lib/geo";
import { parseCallsign, prettyFlightName } from "../lib/callsign";
import { formatAltitude, formatSpeed, type UnitSystem } from "../lib/units";
import { useSky } from "../state/store";

interface AircraftListPanelProps {
  aircraft: readonly StateVector[];
  selectedIcao24: string | null;
  onSelect: (s: StateVector) => void;
  onClose: () => void;
}

type SortKey = "callsign" | "alt-desc" | "alt-asc" | "distance";

export function AircraftListPanel({
  aircraft,
  selectedIcao24,
  onSelect,
  onClose,
}: AircraftListPanelProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("alt-desc");
  const home = useSky((s) => s.home);
  const units = useSky((s) => s.units) as UnitSystem;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let xs = aircraft.filter(
      (s) => s.latitude != null && s.longitude != null
    );
    if (q) {
      xs = xs.filter((s) => {
        const hay =
          (s.callsign?.toLowerCase() ?? "") +
          " " +
          s.icao24.toLowerCase() +
          " " +
          (s.originCountry?.toLowerCase() ?? "");
        return hay.includes(q);
      });
    }
    xs = xs.slice();
    xs.sort((a, b) => compare(a, b, sortKey, home));
    return xs;
  }, [aircraft, query, sortKey, home]);

  return (
    <aside
      className="pointer-events-auto fixed right-0 top-0 z-30 flex h-full w-[340px] max-w-[90vw] flex-col border-l border-ink-800 bg-ink-950/95 backdrop-blur"
      role="complementary"
      aria-label="Aircraft in view"
    >
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
            aircraft in view
          </p>
          <h2 className="text-sm font-semibold text-ink-100">
            {filtered.length} of {aircraft.length}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="font-mono text-[11px] text-ink-400 hover:text-accent"
          aria-label="Close list"
        >
          ESC ×
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Callsign, ICAO24 or country"
          className="flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
          aria-label="Search aircraft"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-300 focus:border-accent focus:outline-none"
          aria-label="Sort by"
        >
          <option value="alt-desc">alt ↓</option>
          <option value="alt-asc">alt ↑</option>
          <option value="callsign">callsign</option>
          {home && <option value="distance">distance</option>}
        </select>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {filtered.map((s) => {
          const parsed = parseCallsign(s.callsign);
          const title = prettyFlightName(parsed);
          const alt = formatAltitude(
            s.baroAltitudeM ?? s.geoAltitudeM ?? null,
            units
          );
          const isSel = s.icao24 === selectedIcao24;
          const d =
            home && s.latitude != null && s.longitude != null
              ? haversineMeters(home, {
                  lat: s.latitude,
                  lon: s.longitude,
                })
              : null;
          return (
            <li key={s.icao24}>
              <button
                onClick={() => onSelect(s)}
                className={`flex w-full items-start justify-between gap-3 border-b border-ink-900 px-4 py-2 text-left transition hover:bg-ink-900 ${
                  isSel ? "bg-ink-900 ring-1 ring-accent/50" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-mono tabular-nums text-sm text-ink-100">
                    {title}
                  </span>
                  <span className="block font-mono text-[10px] uppercase tracking-wider text-ink-500">
                    {s.icao24}
                    {s.originCountry ? ` · ${s.originCountry}` : ""}
                  </span>
                </span>
                <span className="text-right font-mono tabular-nums text-[10px] text-ink-400">
                  <span className="block">{alt}</span>
                  <span className="block">
                    {formatSpeed(s.velocityMps, units)}
                  </span>
                  {d != null && (
                    <span className="block text-ink-500">
                      {d < 1_000
                        ? `${Math.round(d)} m`
                        : `${(d / 1_000).toFixed(1)} km`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="border-t border-ink-800 px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-ink-500">
        data · opensky network · updates every 10 s
      </footer>
    </aside>
  );
}

function compare(
  a: StateVector,
  b: StateVector,
  key: SortKey,
  home: LatLon | null
): number {
  switch (key) {
    case "callsign": {
      return (a.callsign ?? a.icao24).localeCompare(b.callsign ?? b.icao24);
    }
    case "alt-asc": {
      const aa = a.baroAltitudeM ?? a.geoAltitudeM ?? 0;
      const bb = b.baroAltitudeM ?? b.geoAltitudeM ?? 0;
      return aa - bb;
    }
    case "alt-desc": {
      const aa = a.baroAltitudeM ?? a.geoAltitudeM ?? 0;
      const bb = b.baroAltitudeM ?? b.geoAltitudeM ?? 0;
      return bb - aa;
    }
    case "distance": {
      if (!home) return 0;
      const da =
        a.latitude == null || a.longitude == null
          ? Infinity
          : haversineMeters(home, { lat: a.latitude, lon: a.longitude });
      const db =
        b.latitude == null || b.longitude == null
          ? Infinity
          : haversineMeters(home, { lat: b.latitude, lon: b.longitude });
      return da - db;
    }
  }
}
