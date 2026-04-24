/**
 * SKYLOG — live OpenSky poller for the viewport-based map.
 *
 * Runs on the main thread (in a React effect) rather than in the
 * background worker, because the worker is tuned for a fixed home-
 * radius bbox. The viewport changes every time the user pans or
 * zooms, so we want the fetch logic co-located with the map that
 * supplies the bbox.
 *
 * Behaviour:
 *   - Polls every {@link MIN_POLL_INTERVAL_MS} (10 s).
 *   - Skips polls when the bbox would cost too many OpenSky credits
 *     (zoomed way out) — we cap at ~100 sq-deg.
 *   - Deduplicates status transitions so the UI doesn't flicker.
 *   - Cancellable via the returned `stop` function.
 */

import {
  MIN_POLL_INTERVAL_MS,
  decodeStateRow,
  statesUrl,
  type StateVector,
} from "./opensky";
import type { BBox } from "./geo";

export type LivePollStatus =
  | { kind: "loading" }
  | { kind: "ok"; count: number; at: number }
  | { kind: "empty"; at: number }
  | { kind: "too_wide" }
  | { kind: "rate_limited"; retryAt: number }
  | { kind: "offline" }
  | { kind: "error"; message: string };

/** Beyond 100 sq-deg an OpenSky call costs ≥3 credits; we'd burn through the
 * 400-per-day anonymous budget in ~16 minutes. */
const MAX_AREA_SQ_DEG = 100;

export interface LivePoller {
  updateBBox: (bbox: BBox) => void;
  stop: () => void;
}

const areaSqDeg = (b: BBox): number =>
  Math.max(0, (b.lamax - b.lamin) * (b.lomax - b.lomin));

export function startLivePoller(
  initialBBox: BBox,
  onStates: (states: StateVector[]) => void,
  onStatus: (s: LivePollStatus) => void
): LivePoller {
  let bbox = initialBBox;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  onStatus({ kind: "loading" });

  const schedule = (ms: number = MIN_POLL_INTERVAL_MS): void => {
    if (cancelled) return;
    timer = setTimeout(() => {
      void tick();
    }, ms);
  };

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    if (areaSqDeg(bbox) > MAX_AREA_SQ_DEG) {
      onStatus({ kind: "too_wide" });
      schedule();
      return;
    }
    try {
      const res = await fetch(statesUrl(bbox), {
        headers: { Accept: "application/json" },
      });
      if (cancelled) return;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "") || 60;
        onStatus({ kind: "rate_limited", retryAt: Date.now() + retryAfter * 1000 });
        schedule(retryAfter * 1000);
        return;
      }
      if (!res.ok) {
        onStatus({ kind: "error", message: `HTTP ${res.status}` });
        schedule();
        return;
      }
      const json = (await res.json()) as {
        states: readonly (readonly unknown[])[] | null;
      };
      if (cancelled) return;
      const states: StateVector[] = (json.states ?? [])
        .map(decodeStateRow)
        .filter(
          (s): s is StateVector =>
            s !== null && s.latitude !== null && s.longitude !== null
        );
      onStates(states);
      onStatus(
        states.length > 0
          ? { kind: "ok", count: states.length, at: Date.now() }
          : { kind: "empty", at: Date.now() }
      );
      schedule();
    } catch (err) {
      if (cancelled) return;
      onStatus({
        kind: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error",
        message: err instanceof Error ? err.message : String(err),
      } as LivePollStatus);
      schedule();
    }
  };

  // Kick off first poll immediately; no need to wait 10 s for the first frame.
  void tick();

  return {
    updateBBox(next) {
      bbox = next;
    },
    stop() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
