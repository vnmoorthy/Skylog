/**
 * SKYLOG — Zustand store.
 *
 * One store, intentionally flat. Preferences persist to localStorage;
 * the pass buffer and live-tick data live here only as a read cache.
 *
 * The worker owns the ground truth (IndexedDB). The store mirrors what
 * the UI needs to render.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { LatLon } from "../lib/geo";
import type { UnitSystem } from "../lib/units";
import type { AircraftPass } from "../lib/db";
import type { LivePoint, OutboundMessage } from "../workers/skyPoller.worker";

export type ConnectivityStatus =
  | { kind: "booting" }
  | { kind: "idle"; creditsUsed: number; nextPollAt: number }
  | { kind: "polling"; creditsUsed: number; nextPollAt: number }
  | { kind: "rate_limited"; until: number; creditsUsed: number }
  | { kind: "offline"; creditsUsed: number; nextPollAt: number }
  | { kind: "error"; message: string; creditsUsed: number };

export type Theme = "light" | "dark"

/* ---- persisted slice ---- */

export interface Preferences {
  readonly home: LatLon | null;
  readonly radiusMeters: number;
  readonly units: UnitSystem;
  /** Dismissed the first-run onboarding screen at least once. */
  readonly onboarded: boolean;
  readonly theme: Theme;
}

const DEFAULT_PREFS: Preferences = {
  home: null,
  radiusMeters: 25_000,
  units: "imperial",
  onboarded: false,
  theme: "dark"
};

/* ---- ephemeral slice ---- */

export interface RuntimeState {
  readonly status: ConnectivityStatus;
  /** Passes currently loaded into memory for rendering. */
  readonly passes: Record<string, AircraftPass>;
  /** Live-tick snapshot of the last poll. */
  readonly live: readonly LivePoint[];
  readonly liveAt: number;
  /** Currently-selected pass for the detail panel. */
  readonly selectedPassId: string | null;
  /** Settings drawer open? */
  readonly settingsOpen: boolean;
}

export interface SkyStore extends Preferences, RuntimeState {
  setHome: (home: LatLon) => void;
  setRadius: (radiusMeters: number) => void;
  setUnits: (u: UnitSystem) => void;
  markOnboarded: () => void;
  resetHome: () => void;

  applyWorkerMessage: (msg: OutboundMessage) => void;
  setInitialPasses: (passes: AircraftPass[]) => void;

  toggleTheme: () => void;

  selectPass: (passId: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useSky = create<SkyStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,

      status: { kind: "booting" },
      passes: {},
      live: [],
      liveAt: 0,
      selectedPassId: null,
      settingsOpen: false,

      setHome: (home) => set({ home, onboarded: true, passes: {}, live: [] }),
      setRadius: (radiusMeters) => set({ radiusMeters }),
      setUnits: (units) => set({ units }),
      markOnboarded: () => set({ onboarded: true }),
      resetHome: () =>
        set({
          home: null,
          onboarded: false,
          passes: {},
          live: [],
          selectedPassId: null,
        }),

      selectPass: (passId) => set({ selectedPassId: passId }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setInitialPasses: (passes) => {
        const map: Record<string, AircraftPass> = {};
        for (const p of passes) map[p.passId] = p;
        set({ passes: map });
      },

      applyWorkerMessage: (msg) => {
        switch (msg.type) {
          case "STATUS":
            if (msg.kind === "rate_limited") {
              set({
                status: {
                  kind: "rate_limited",
                  until: msg.until,
                  creditsUsed: msg.creditsUsed,
                },
              });
            } else if (msg.kind === "error") {
              set({
                status: {
                  kind: "error",
                  message: msg.message,
                  creditsUsed: msg.creditsUsed,
                },
              });
            } else {
              set({
                status: {
                  kind: msg.kind,
                  creditsUsed: msg.creditsUsed,
                  nextPollAt: msg.nextPollAt,
                },
              });
            }
            return;
          case "PASS_UPDATED":
            set((s) => ({
              passes: { ...s.passes, [msg.pass.passId]: msg.pass },
            }));
            return;
          case "PASS_CLOSED":
            // Keep the pass in memory — "closed" just means no longer
            // being extended. The timeline still renders it.
            return;
          case "LIVE_TICK":
            set({ live: msg.aircraft, liveAt: msg.at });
            return;
        }
      },

      toggleTheme: () => set((s) => ({ 
        theme: s.theme === "dark" ? "light" : "dark" 
      })),
    }),
    {
      name: "skylog/prefs/v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        home: s.home,
        radiusMeters: s.radiusMeters,
        units: s.units,
        onboarded: s.onboarded,
        theme: s.theme,
      }),
    }
  )
);

/* ---- selectors ---- */

export function selectPassesSortedByTime(
  s: Pick<SkyStore, "passes">
): AircraftPass[] {
  return Object.values(s.passes).sort(
    (a, b) => a.closestApproachAt - b.closestApproachAt
  );
}

export function selectPassesInWindow(
  s: Pick<SkyStore, "passes">,
  fromMs: number,
  toMs: number
): AircraftPass[] {
  const out: AircraftPass[] = [];
  for (const p of Object.values(s.passes)) {
    if (p.closestApproachAt >= fromMs && p.closestApproachAt <= toMs) {
      out.push(p);
    }
  }
  out.sort((a, b) => a.closestApproachAt - b.closestApproachAt);
  return out;
}
