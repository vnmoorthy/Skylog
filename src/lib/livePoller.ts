/**
 * SKYLOG — live OpenSky poller for the viewport-based map.
 *
 * Responsibilities:
 *   - Poll OpenSky /states/all for whatever bbox the map is currently
 *     showing, no more often than MIN_POLL_INTERVAL_MS (10 s).
 *   - Skip polls whose bbox is so wide that a single call would cost ≥3
 *     credits (OpenSky charges more for larger areas) — we cap area so
 *     the 400 anonymous credits/day don't evaporate in minutes.
 *   - Surface a discriminated-union status so the UI can render every
 *     state meaningfully: loading, ok (N aircraft), empty, too_wide,
 *     rate_limited (with retry-at), offline, error.
 *   - Be cancellable: stop() cleans up timers and in-flight fetches.
 *
 * This lives on the main thread because the bbox moves whenever the
 * user pans/zooms. Pushing it into a worker would add IPC churn for
 * every map interaction and buy us nothing.
 */

import {
  MIN_POLL_INTERVAL_MS,
  creditCost,
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

/** Bbox area above which we decline to poll (OpenSky would charge 3–4 credits). */
export const MAX_POLLED_AREA_SQ_DEG = 100;

export interface LivePoller {
  /** Swap in a new bbox — takes effect at the next poll. */
  readonly updateBBox: (bbox: BBox) => void;
  /** Force an immediate poll (respecting MIN_POLL_INTERVAL_MS). */
  readonly pokeNow: () => void;
  /** Cancel all future polls and in-flight requests. */
  readonly stop: () => void;
}

const bboxArea = (b: BBox): number =>
  Math.max(0, b.lamax - b.lamin) * Math.max(0, b.lomax - b.lomin);

export function startLivePoller(
  initialBBox: BBox,
  onStates: (states: StateVector[]) => void,
  onStatus: (s: LivePollStatus) => void
): LivePoller {
  let bbox = initialBBox;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPollAt = 0;
  let abort: AbortController | null = null;

  onStatus({ kind: "loading" });

  const poll = async (): Promise<void> => {
    if (cancelled) return;
    lastPollAt = Date.now();

    if (bboxArea(bbox) > MAX_POLLED_AREA_SQ_DEG) {
      onStatus({ kind: "too_wide" });
      schedule(MIN_POLL_INTERVAL_MS);
      return;
    }
    // Informational — we aren't throttling by cost yet, but future
    // versions may.
    creditCost(bbox);

    abort?.abort();
    abort = new AbortController();
    try {
      const res = await fetch(statesUrl(bbox), {
        headers: { Accept: "application/json" },
        signal: abort.signal,
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
        schedule(MIN_POLL_INTERVAL_MS);
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
      schedule(MIN_POLL_INTERVAL_MS);
    } catch (err) {
      if (cancelled) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      onStatus({
        kind: navigator.onLine ? "error" : "offline",
        message: err instanceof Error ? err.message : String(err),
      } as LivePollStatus);
      schedule(MIN_POLL_INTERVAL_MS);
    }
  };

  const schedule = (ms: number): void => {
    if (cancelled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void poll();
    }, ms);
  };

  // First poll: immediately.
  void poll();

  return {
    updateBBox(next) {
      bbox = next;
    },
    pokeNow() {
      const elapsed = Date.now() - lastPollAt;
      const wait = Math.max(0, MIN_POLL_INTERVAL_MS - elapsed);
      schedule(wait);
    },
    stop() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abort?.abort();
    },
  };
}
