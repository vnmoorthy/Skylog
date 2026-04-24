/**
 * SKYLOG — root component.
 *
 * Mounts the worker once on first home-location, hydrates passes from
 * IndexedDB, and wires the Timeline + LivePanel + DetailPanel + Settings.
 */

import { useEffect, useMemo, useRef } from "react";
import { useSky } from "./state/store";
import { db } from "./lib/db";
import { HomeSetup } from "./components/HomeSetup";
import { Timeline, LoudnessLegend } from "./components/Timeline";
import { LivePanel } from "./components/LivePanel";
import { DetailPanel } from "./components/DetailPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { EmptyState } from "./components/EmptyState";
import { formatClock } from "./lib/units";
import { loadAircraftDb } from "./lib/aircraftDb";
import type {
  InboundMessage,
  OutboundMessage,
} from "./workers/skyPoller.worker";

export function App(): JSX.Element {
  const home = useSky((s) => s.home);
  const onboarded = useSky((s) => s.onboarded);

  if (!home || !onboarded) return <HomeSetup />;
  return <Dashboard />;
}

function Dashboard(): JSX.Element {
  const home = useSky((s) => s.home);
  const radius = useSky((s) => s.radiusMeters);
  const applyMsg = useSky((s) => s.applyWorkerMessage);
  const setInitial = useSky((s) => s.setInitialPasses);
  const status = useSky((s) => s.status);
  const setSettingsOpen = useSky((s) => s.setSettingsOpen);
  const passCount = useSky((s) => Object.keys(s.passes).length);

  const workerRef = useRef<Worker | null>(null);

  // Boot: hydrate persisted passes, start the aircraft DB lazy load,
  // and spin up the worker.
  useEffect(() => {
    if (!home) return;
    let cancelled = false;

    (async () => {
      const saved = await db.passes
        .where("firstSeen")
        .above(Date.now() - 72 * 60 * 60 * 1000)
        .toArray();
      if (!cancelled) setInitial(saved);
    })().catch(() => {
      /* non-fatal */
    });

    // Kick off the aircraft DB load so the DetailPanel doesn't show "..."
    // when the first pass arrives.
    loadAircraftDb().catch(() => {
      /* non-fatal */
    });

    const w = new Worker(
      new URL("./workers/skyPoller.worker.ts", import.meta.url),
      { type: "module", name: "skylog-poller" }
    );
    workerRef.current = w;

    w.addEventListener("message", (ev: MessageEvent<OutboundMessage>) => {
      applyMsg(ev.data);
    });

    const startMsg: InboundMessage = {
      type: "START",
      home,
      radiusMeters: radius,
    };
    w.postMessage(startMsg);

    return () => {
      cancelled = true;
      w.postMessage({ type: "STOP" } as InboundMessage);
      w.terminate();
      workerRef.current = null;
    };
    // We specifically want to re-init when home identity or radius changes.
  }, [home?.lat, home?.lon]);

  // Send radius updates to the running worker without restarting it.
  useEffect(() => {
    if (!workerRef.current || !home) return;
    workerRef.current.postMessage({
      type: "UPDATE_HOME",
      home,
      radiusMeters: radius,
    } as InboundMessage);
  }, [radius]);

  const statusText = useMemo(() => {
    switch (status.kind) {
      case "idle":
        return `idle · next poll ${formatClock(status.nextPollAt)}`;
      case "polling":
        return `polling · ${status.creditsUsed} credits used today`;
      case "rate_limited":
        return `rate-limited · resumes ${formatClock(status.until)}`;
      case "offline":
        return "offline · reconnecting";
      case "error":
        return `error · ${status.message}`;
      case "booting":
        return "starting…";
    }
  }, [status]);

  return (
    <div className="relative min-h-screen bg-ink-950 text-ink-100">
      {/* header */}
      <header className="flex items-center justify-between border-b border-ink-800 px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-100">
            skylog
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            {home ? `home ${home.lat.toFixed(3)}, ${home.lon.toFixed(3)}` : ""}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
            {statusText}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <LoudnessLegend />
          <button
            onClick={() => setSettingsOpen(true)}
            className="font-mono text-[11px] uppercase tracking-wider text-ink-300 hover:text-accent"
          >
            Settings
          </button>
        </div>
      </header>

      {/* main */}
      <main className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-400">
              last 24 hours · {passCount} pass{passCount === 1 ? "" : "es"}
            </h2>
            <p className="font-mono text-[10px] text-ink-500">
              hover a bar · click to open · ← → to scrub · esc to close
            </p>
          </div>
          <div className="rounded border border-ink-800 bg-ink-900/50 p-3">
            {passCount === 0 ? <EmptyState /> : <Timeline />}
          </div>

          <div className="mt-6 font-mono text-[10px] uppercase tracking-wider text-ink-500">
            <p>
              loudness is an estimate from an on-device model. color is not a
              measurement — it's the inverse-square law plus atmospheric
              absorption, applied to an aircraft-category source level.
            </p>
          </div>
        </section>

        <aside className="space-y-6">
          <LivePanel />
        </aside>
      </main>

      <DetailPanel />
      <SettingsDrawer />
    </div>
  );
}
