/**
 * SKYLOG — aircraft memory drawer.
 *
 * Left-side slide-in panel that answers "which planes does Skylog
 * remember?" The gbrain-shaped surface: a running digest of totals +
 * a scrollable list of the most frequent visitors, ranked by visit
 * count.
 *
 * Data comes from the `sightings` IndexedDB table. Opened via the
 * TopBar "memory" button (shortcut: m).
 */

import { useEffect, useState } from "react";
import {
  digestSummary,
  topFrequentVisitors,
  regularVisitors,
  busiestHour,
  airlineDistribution,
  prettyPattern,
  type DigestSummary,
  type RegularVisitor,
  type HourOfDayStat,
  type AirlineShare,
} from "../lib/sightings";
import type { AircraftSighting } from "./../lib/db";
import { parseCallsign, prettyFlightName } from "../lib/callsign";

interface MemoryDrawerProps {
  onClose: () => void;
  onSelectIcao24: (icao24: string) => void;
}

export function MemoryDrawer({
  onClose,
  onSelectIcao24,
}: MemoryDrawerProps): JSX.Element {
  const [digest, setDigest] = useState<DigestSummary | null>(null);
  const [top, setTop] = useState<AircraftSighting[] | null>(null);
  const [regulars, setRegulars] = useState<RegularVisitor[] | null>(null);
  const [peakHour, setPeakHour] = useState<HourOfDayStat | null>(null);
  const [airlines, setAirlines] = useState<AirlineShare[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, topList, regs, bh, airs] = await Promise.all([
        digestSummary(),
        topFrequentVisitors(30),
        regularVisitors(8),
        busiestHour(),
        airlineDistribution(8),
      ]);
      if (cancelled) return;
      setDigest(d);
      setTop(topList);
      setRegulars(regs);
      setPeakHour(bh);
      setAirlines(airs);
    })().catch(() => {
      /* non-fatal */
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      className="pointer-events-auto fixed left-0 top-0 z-40 flex h-full w-[340px] max-w-[92vw] flex-col border-r border-ink-800 bg-ink-950/95 backdrop-blur"
      role="complementary"
      aria-label="Aircraft memory"
    >
      <header className="flex items-start justify-between border-b border-ink-800 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
            skylog memory
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-ink-100">
            {digest?.totalSeen.toLocaleString() ?? "—"} planes remembered
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Every plane Skylog has ever seen on your device. Data lives only
            in your browser.
          </p>
        </div>
        <button
          onClick={onClose}
          className="font-mono text-[11px] text-ink-400 hover:text-accent"
          aria-label="Close"
        >
          ESC ×
        </button>
      </header>

      <section className="border-b border-ink-800 px-4 py-3">
        <p className="font-mono text-[9px] uppercase tracking-widest text-ink-500">
          today vs yesterday
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <DigestStat
            value={digest?.todayCount ?? 0}
            label="today"
          />
          <DigestStat
            value={digest?.yesterdayCount ?? 0}
            label="yesterday"
          />
          <DigestStat
            value={digest?.newTodayCount ?? 0}
            label="first-timers today"
            tone="accent"
          />
        </div>
      </section>

      {regulars && regulars.length > 0 && (
        <section className="border-b border-ink-800 px-4 py-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-accent">
            regular visitors · patterns
          </p>
          <ul className="mt-2 space-y-1.5">
            {regulars.map((r) => (
              <li key={r.sighting.icao24}>
                <button
                  onClick={() => onSelectIcao24(r.sighting.icao24)}
                  className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-1 text-left hover:bg-ink-900"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm tabular-nums text-ink-100">
                      {r.sighting.lastCallsign ?? r.sighting.icao24.toUpperCase()}
                    </span>
                    <span className="block font-mono text-[10px] text-ink-400">
                      {prettyPattern(r.pattern)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-accent">
                    ×{r.pattern.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {peakHour && (
        <section className="border-b border-ink-800 px-4 py-3 font-mono text-[10px] text-ink-400">
          <span className="uppercase tracking-widest text-ink-500">
            busiest hour ·{" "}
          </span>
          <span className="text-ink-100">
            {peakHour.hour.toString().padStart(2, "0")}:00
          </span>
          <span className="text-ink-500"> · {peakHour.count} sightings</span>
        </section>
      )}

      {airlines && airlines.length > 0 && (
        <section className="border-b border-ink-800 px-4 py-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-accent">
            top airlines over your sky
          </p>
          <ul className="mt-2 space-y-1.5">
            {airlines.map((a) => (
              <li key={a.icao ?? "_unknown"} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-100">
                  {a.name}
                </span>
                <span className="font-mono tabular-nums text-[10px] text-ink-400">
                  {a.count}
                </span>
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.max(2, Math.round(a.share * 100))}%` }}
                  />
                </div>
                <span className="w-10 text-right font-mono tabular-nums text-[10px] text-ink-300">
                  {(a.share * 100).toFixed(a.share < 0.1 ? 1 : 0)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}


      <div className="flex-1 overflow-y-auto">
        <p className="px-4 py-3 font-mono text-[9px] uppercase tracking-widest text-ink-500">
          all frequent visitors
        </p>
        {top == null ? (
          <p className="px-4 text-xs text-ink-500">Loading…</p>
        ) : top.length === 0 ? (
          <div className="px-4 pb-6 text-xs leading-relaxed text-ink-400">
            No memories yet. Skylog records every plane the moment it enters
            your viewport. Keep the tab open for a few minutes and this list
            fills in.
          </div>
        ) : (
          <ul>
            {top.map((s) => {
              const title = prettyFlightName(parseCallsign(s.lastCallsign));
              return (
                <li key={s.icao24}>
                  <button
                    onClick={() => onSelectIcao24(s.icao24)}
                    className="flex w-full items-start justify-between gap-3 border-b border-ink-900 px-4 py-2 text-left transition hover:bg-ink-900"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono tabular-nums text-sm text-ink-100">
                        {title}
                      </span>
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-ink-500">
                        {s.icao24}
                        {s.typecode ? ` · ${s.typecode}` : ""}
                        {s.operator ? ` · ${s.operator}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono tabular-nums text-[10px] text-ink-300">
                      <span className="block text-accent">
                        {s.sightingCount}×
                      </span>
                      <span className="block text-ink-500">
                        {s.dayCount} day{s.dayCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="border-t border-ink-800 px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-ink-500">
        memory grows over time · no data leaves your device
      </footer>
    </aside>
  );
}

function DigestStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "accent";
}): JSX.Element {
  return (
    <div className="rounded border border-ink-800 bg-ink-900/60 p-2">
      <p
        className={`font-mono tabular-nums text-xl font-semibold ${
          tone === "accent" ? "text-accent" : "text-ink-100"
        }`}
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-500">
        {label}
      </p>
    </div>
  );
}
