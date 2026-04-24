/**
 * SKYLOG — persistent "today's sky" digest.
 *
 * Bottom-right of the map (desktop) / bottom drawer (mobile). Always
 * visible — this is the hook that rewards returning users. Shows:
 *   - today's sighting total vs yesterday's
 *   - first-time visitors today
 *   - busiest hour of day (all time)
 *   - the most prominent "regular visitor" pattern if we have one
 *
 * Collapsible; collapsed state is persisted in localStorage so we
 * don't pester users who dismissed it.
 */

import { useEffect, useState } from "react";
import {
  busiestHour,
  digestSummary,
  regularVisitors,
  type DigestSummary,
  type HourOfDayStat,
  type RegularVisitor,
} from "../lib/sightings";

const STORAGE_KEY = "skylog:digest:collapsed";

interface DigestCardProps {
  onShowMemory: () => void;
  onTrackRegular: (icao24: string) => void;
}

export function DigestCard({
  onShowMemory,
  onTrackRegular,
}: DigestCardProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [digest, setDigest] = useState<DigestSummary | null>(null);
  const [regulars, setRegulars] = useState<RegularVisitor[] | null>(null);
  const [peak, setPeak] = useState<HourOfDayStat | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const [d, r, p] = await Promise.all([
        digestSummary(),
        regularVisitors(3),
        busiestHour(),
      ]);
      if (cancelled) return;
      setDigest(d);
      setRegulars(r);
      setPeak(p);
    };
    load().catch(() => {
      /* non-fatal */
    });
    // Refresh every 2 minutes.
    const t = window.setInterval(() => {
      load().catch(() => undefined);
    }, 120_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  if (!digest || digest.totalSeen === 0) return <></>;

  const delta =
    digest.todayCount - digest.yesterdayCount;
  const deltaStr =
    delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
  const deltaClass =
    delta > 0 ? "text-[#43e27a]" : delta < 0 ? "text-[#ef4c24]" : "text-ink-400";

  return (
    <div
      className={`pointer-events-auto absolute right-3 top-[4.5rem] z-20 ${
        collapsed ? "w-auto" : "w-[300px] max-w-[calc(100vw-1.5rem)]"
      } rounded-md border border-ink-800 bg-ink-900/85 backdrop-blur transition-all`}
      role="status"
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink-400 hover:text-accent"
      >
        <span>today's sky</span>
        <span className={`tabular-nums ${deltaClass}`}>
          {digest.todayCount} {collapsed && `(${deltaStr})`}
        </span>
      </button>
      {!collapsed && (
        <div className="border-t border-ink-800 px-3 py-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="today" value={digest.todayCount.toLocaleString()} />
            <Stat
              label="yesterday"
              value={digest.yesterdayCount.toLocaleString()}
              tone="muted"
            />
            <Stat
              label="new today"
              value={digest.newTodayCount.toLocaleString()}
              tone="accent"
            />
          </div>
          {peak && (
            <p className="mt-3 font-mono text-[10px] text-ink-400">
              <span className="uppercase tracking-widest text-ink-500">
                peak hour ·{" "}
              </span>
              <span className="text-ink-100">
                {peak.hour.toString().padStart(2, "0")}:00
              </span>
            </p>
          )}
          {regulars && regulars.length > 0 && (
            <div className="mt-3 border-t border-ink-800 pt-2">
              <p className="font-mono text-[9px] uppercase tracking-widest text-ink-500">
                regular over your sky
              </p>
              <ul className="mt-1 space-y-0.5">
                {regulars.map((r) => (
                  <li key={r.sighting.icao24}>
                    <button
                      onClick={() => onTrackRegular(r.sighting.icao24)}
                      className="group flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-ink-800/60"
                    >
                      <span className="min-w-0 truncate font-mono text-xs text-ink-100 group-hover:text-accent">
                        {r.sighting.lastCallsign ??
                          r.sighting.icao24.toUpperCase()}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-400">
                        {prettyDay(r.pattern.weekday)}s{" "}
                        {r.pattern.hour.toString().padStart(2, "0")}:00
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={onShowMemory}
            className="mt-3 block w-full rounded border border-ink-700 px-2 py-1 text-center font-mono text-[10px] uppercase tracking-wider text-ink-300 hover:border-accent hover:text-accent"
          >
            open memory
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "muted" | "accent";
}): JSX.Element {
  const color =
    tone === "accent" ? "text-accent" : tone === "muted" ? "text-ink-400" : "text-ink-100";
  return (
    <div>
      <p className={`font-mono tabular-nums text-lg font-semibold ${color}`}>
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-500">
        {label}
      </p>
    </div>
  );
}

function prettyDay(wd: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd] ?? "?";
}
