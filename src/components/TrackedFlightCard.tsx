/**
 * SKYLOG — persistent card for a flight-number-tracked aircraft.
 *
 * Sits at the bottom-center of the screen when a user is tracking a
 * callsign. Shows live altitude/speed/heading, distance to home, ETA
 * if a home is set. Doesn't go away when the tracked flight leaves
 * the map viewport — the whole point is to let you *follow* the
 * flight across the world without re-finding it.
 *
 * Includes a "follow on map" toggle that makes the map camera track
 * the aircraft in real time.
 */

import type { TrackedFlightStatus } from "../lib/flightTracker";
import { parseCallsign, prettyFlightName } from "../lib/callsign";
import { formatAltitude, formatSpeed, type UnitSystem } from "../lib/units";
import { useSky } from "../state/store";

interface TrackedFlightCardProps {
  status: TrackedFlightStatus;
  following: boolean;
  onToggleFollow: () => void;
  onStop: () => void;
}

export function TrackedFlightCard({
  status,
  following,
  onToggleFollow,
  onStop,
}: TrackedFlightCardProps): JSX.Element {
  const units = useSky((s) => s.units) as UnitSystem;

  const callsign =
    status.kind === "live"
      ? status.state.callsign ?? status.state.icao24.toUpperCase()
      : status.kind === "lost" || status.kind === "searching"
      ? status.callsign
      : "—";
  const title = prettyFlightName(parseCallsign(callsign));

  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-1/2 z-30 w-[min(640px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-md border border-accent/50 bg-ink-900/95 shadow-2xl backdrop-blur"
      role="region"
      aria-label={`Tracked flight ${callsign}`}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[9px] uppercase tracking-widest text-accent">
                tracking
              </span>
              <span className="truncate font-mono text-sm font-semibold text-ink-100">
                {title}
              </span>
              {status.kind === "live" && status.state._typeCode && (
                <span className="truncate font-mono text-[10px] text-ink-400">
                  · {status.state._typeCode}
                  {status.state._operator ? ` · ${status.state._operator}` : ""}
                </span>
              )}
            </div>
            <TrackedStatusLine status={status} units={units} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onToggleFollow}
            className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
              following
                ? "bg-accent/20 text-accent"
                : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"
            }`}
            disabled={status.kind !== "live"}
            title="Follow the tracked flight with the map camera"
          >
            {following ? "following" : "follow"}
          </button>
          <button
            onClick={onStop}
            className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-400 hover:text-accent"
          >
            stop
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackedStatusLine({
  status,
  units,
}: {
  status: TrackedFlightStatus;
  units: UnitSystem;
}): JSX.Element {
  if (status.kind === "searching") {
    return (
      <p className="font-mono text-[11px] text-ink-400">
        searching for <span className="text-ink-100">{status.callsign}</span> in
        the global live feed…
      </p>
    );
  }
  if (status.kind === "lost") {
    const mins = Math.round((Date.now() - status.lastSeenAt) / 60_000);
    return (
      <p className="font-mono text-[11px] text-ink-400">
        lost contact {mins}m ago · keeping watch
      </p>
    );
  }
  if (status.kind === "offline") {
    return <p className="font-mono text-[11px] text-accent">you're offline</p>;
  }
  if (status.kind === "error") {
    return (
      <p className="font-mono text-[11px] text-accent">error · {status.message}</p>
    );
  }
  // live
  const alt = formatAltitude(
    status.state.baroAltitudeM ?? status.state.geoAltitudeM ?? null,
    units
  );
  const spd = formatSpeed(status.state.velocityMps, units);
  const distKm =
    status.distanceM != null
      ? status.distanceM < 1_000
        ? `${Math.round(status.distanceM)} m`
        : `${(status.distanceM / 1_000).toFixed(1)} km`
      : null;
  const etaMin =
    status.etaSec != null && status.etaSec > 0
      ? Math.round(status.etaSec / 60)
      : null;
  return (
    <p className="font-mono tabular-nums text-[11px] text-ink-300">
      {alt} · {spd}
      {distKm && ` · ${distKm} from home`}
      {etaMin != null && etaMin < 600 && ` · ~${etaMin} min away`}
    </p>
  );
}
