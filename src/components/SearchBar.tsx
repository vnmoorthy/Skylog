/**
 * SKYLOG — search bar.
 *
 * Lives in the TopBar. Filters the currently-visible aircraft against
 * its callsign or ICAO24 hex code with a forgiving prefix match. When
 * the user picks a result, we fire an onSelect handler and the map
 * flies to that flight.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { StateVector } from "../lib/opensky";

interface SearchBarProps {
  visible: readonly StateVector[];
  onPick: (s: StateVector) => void;
}

export function SearchBar({ visible, onPick }: SearchBarProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global "/" shortcut to focus search — same as GitHub, FlightRadar24, etc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    return visible
      .filter(
        (s) =>
          (s.callsign ?? "").toUpperCase().includes(q) ||
          s.icao24.toUpperCase().includes(q)
      )
      .slice(0, 8);
  }, [query, visible]);

  return (
    <div className="pointer-events-auto relative">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={`Search callsign or ICAO24…  (press /)`}
        className="w-60 rounded bg-ink-900/85 px-3 py-1.5 font-mono text-[11px] text-ink-100 placeholder-ink-500 outline-none ring-1 ring-inset ring-ink-800 backdrop-blur focus:ring-accent"
      />
      {open && results.length > 0 && (
        <ul className="absolute right-0 top-full mt-1 w-72 overflow-hidden rounded border border-ink-800 bg-ink-900/95 shadow-xl backdrop-blur">
          {results.map((r) => (
            <li key={r.icao24}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(r);
                  setQuery("");
                  setOpen(false);
                  inputRef.current?.blur();
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-mono text-[11px] hover:bg-ink-800/80"
              >
                <span className="text-ink-100">
                  {r.callsign?.trim() || r.icao24.toUpperCase()}
                </span>
                <span className="text-ink-500">
                  {r.icao24} · {r.originCountry ?? "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
