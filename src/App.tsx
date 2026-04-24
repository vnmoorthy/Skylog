/**
 * SKYLOG — root component.
 *
 * Layout:
 *   - Full-screen LiveMap as the hero.
 *   - Floating TopBar with brand, layer toggles, search, nav buttons.
 *   - Click-a-plane opens a right-side FlightCard.
 *   - Optional drawers: Home setup, historical timeline, settings.
 *   - "?" key opens a help/about overlay.
 *
 * The old home-based pass worker (loudness timeline) is still wired
 * up, but only started once the user chooses to set a home — it's no
 * longer a blocker for seeing anything useful.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSky } from "./state/store";
import { db } from "./lib/db";
import { LiveMap } from "./components/LiveMap";
import { FlightCard } from "./components/FlightCard";
import { HomeSetup } from "./components/HomeSetup";
import { TopBar } from "./components/TopBar";
import { SearchBar } from "./components/SearchBar";
import { TimelineDrawer } from "./components/TimelineDrawer";
import { DetailPanel } from "./components/DetailPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { HelpOverlay } from "./components/HelpOverlay";
import { loadAircraftDb } from "./lib/aircraftDb";
import type { StateVector } from "./lib/opensky";
import type {
  InboundMessage,
  OutboundMessage,
} from "./workers/skyPoller.worker";

export function App(): JSX.Element {
  const home = useSky((s) => s.home);
  const applyMsg = useSky((s) => s.applyWorkerMessage);
  const setInitial = useSky((s) => s.setInitialPasses);
  const radius = useSky((s) => s.radiusMeters);

  const [showSatellites, setShowSatellites] = useState<boolean>(false);
  const [homeSetupOpen, setHomeSetupOpen] = useState<boolean>(false);
  const [timelineOpen, setTimelineOpen] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [selectedLive, setSelectedLive] = useState<StateVector | null>(null);
  const [focusIcao, setFocusIcao] = useState<string | null>(null);
  const [visibleAircraft, setVisibleAircraft] = useState<readonly StateVector[]>([]);

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    loadAircraftDb().catch(() => {
      /* non-fatal */
    });
  }, []);

  /* "?" opens help from anywhere. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "?" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Pass-logger worker — only runs when home is set. */
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

    const w = new Worker(
      new URL("./workers/skyPoller.worker.ts", import.meta.url),
      { type: "module", name: "skylog-poller" }
    );
    workerRef.current = w;

    w.addEventListener("message", (ev: MessageEvent<OutboundMessage>) => {
      applyMsg(ev.data);
    });

    w.postMessage({
      type: "START",
      home,
      radiusMeters: radius,
    } as InboundMessage);

    return () => {
      cancelled = true;
      w.postMessage({ type: "STOP" } as InboundMessage);
      w.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home?.lat, home?.lon]);

  useEffect(() => {
    if (!workerRef.current || !home) return;
    workerRef.current.postMessage({
      type: "UPDATE_HOME",
      home,
      radiusMeters: radius,
    } as InboundMessage);
  }, [radius]);

  const handleSelectLive = useCallback((s: StateVector) => {
    setSelectedLive(s);
    setFocusIcao(s.icao24);
  }, []);

  const handleVisibleAircraft = useCallback((states: StateVector[]) => {
    setVisibleAircraft(states);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-ink-950 text-ink-100">
      {/* Full-screen live map */}
      <LiveMap
        onSelectAircraft={handleSelectLive}
        selectedIcao24={selectedLive?.icao24 ?? null}
        showSatellites={showSatellites}
        focusIcao24={focusIcao}
        aircraftOut={handleVisibleAircraft}
      />

      {/* Floating top bar */}
      <TopBar
        showSatellites={showSatellites}
        onToggleSatellites={() => setShowSatellites((v) => !v)}
        onOpenHomeSetup={() => setHomeSetupOpen(true)}
        onOpenTimeline={() => setTimelineOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      >
        <SearchBar
          visible={visibleAircraft}
          onPick={(s) => {
            handleSelectLive(s);
          }}
        />
      </TopBar>

      {/* Click-a-plane card */}
      {selectedLive && (
        <FlightCard
          state={selectedLive}
          onClose={() => {
            setSelectedLive(null);
            setFocusIcao(null);
          }}
        />
      )}

      {/* Historical pass detail panel (opens from the timeline drawer). */}
      <DetailPanel />

      {/* Optional drawers */}
      {homeSetupOpen && (
        <HomeSetup
          onDone={() => setHomeSetupOpen(false)}
          onCancel={() => setHomeSetupOpen(false)}
        />
      )}
      {timelineOpen && (
        <TimelineDrawer onClose={() => setTimelineOpen(false)} />
      )}
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}

      <SettingsDrawer />
    </div>
  );
}
