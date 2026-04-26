/**
 * SKYLOG — viewport filter bar.
 *
 * Top-secondary controls for plane spotters: filter the live map by
 * altitude band or aircraft category. Renders as small chips beneath
 * the TopBar. Empty state = no filter.
 *
 * Filters apply on the client side only — the live poller still
 * fetches the full bbox; we just hide markers that don't match.
 */


export type AltitudeBand = "all" | "low" | "mid" | "high" | "ground";
export type CategoryFilter = "all" | "jets" | "light" | "heli";

interface FilterBarProps {
  altitudeBand: AltitudeBand;
  onAltitudeChange: (b: AltitudeBand) => void;
  categoryFilter: CategoryFilter;
  onCategoryChange: (c: CategoryFilter) => void;
  filteredCount: number;
  totalCount: number;
}

export function FilterBar({
  altitudeBand,
  onAltitudeChange,
  categoryFilter,
  onCategoryChange,
  filteredCount,
  totalCount,
}: FilterBarProps): JSX.Element | null {
  const isFiltered = altitudeBand !== "all" || categoryFilter !== "all";
  if (totalCount === 0 && !isFiltered) return null;

  return (
    <div className="pointer-events-auto absolute left-4 top-[4.5rem] z-20 flex flex-wrap items-center gap-2 rounded bg-ink-900/85 px-3 py-1.5 backdrop-blur">
      <span className="font-mono text-[9px] uppercase tracking-widest text-ink-500">
        filter
      </span>
      <Group
        value={altitudeBand}
        options={[
          ["all", "all alt"],
          ["ground", "ground"],
          ["low", "<10k"],
          ["mid", "10–25k"],
          ["high", ">25k"],
        ]}
        onChange={onAltitudeChange}
      />
      <span className="text-ink-700">·</span>
      <Group
        value={categoryFilter}
        options={[
          ["all", "all"],
          ["jets", "jets"],
          ["light", "light"],
          ["heli", "heli"],
        ]}
        onChange={onCategoryChange}
      />
      <span className="ml-1 font-mono tabular-nums text-[10px] text-ink-400">
        {filteredCount}/{totalCount}
      </span>
    </div>
  );
}

function Group<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <span className="flex items-center">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${
            value === v
              ? "bg-accent/20 text-accent"
              : "text-ink-300 hover:text-ink-100"
          }`}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

/** Pure helper used by LiveMap to decide if a state should be shown. */
export function statePassesFilter(
  s: { baroAltitudeM: number | null; geoAltitudeM: number | null; onGround: boolean; category: number | null },
  altitudeBand: AltitudeBand,
  categoryFilter: CategoryFilter
): boolean {
  // Altitude band
  const altM = s.baroAltitudeM ?? s.geoAltitudeM ?? 0;
  const altFt = altM * 3.28084;
  if (altitudeBand === "ground" && !s.onGround) return false;
  if (altitudeBand === "low" && (s.onGround || altFt >= 10_000)) return false;
  if (altitudeBand === "mid" && (altFt < 10_000 || altFt >= 25_000)) return false;
  if (altitudeBand === "high" && altFt < 25_000) return false;

  // Category — OpenSky/airplanes.live category enum:
  // 0 no info, 1 light, 2 small, 3 large, 4 high-vortex, 5 heavy, 6 high-perf, 7 rotorcraft
  if (categoryFilter !== "all") {
    const c = s.category;
    if (categoryFilter === "heli" && c !== 7) return false;
    if (categoryFilter === "light" && c !== 1) return false;
    if (categoryFilter === "jets" && (c == null || c < 3 || c > 6)) return false;
  }
  return true;
}
