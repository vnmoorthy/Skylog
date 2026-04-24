/**
 * SKYLOG — root component.
 *
 * Layout (v0.2 rebuild):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  TopBar (brand · [sats toggle] [list] [home] [tl] [set]) │ z-40
 *   │                                                          │
 *   │            ╭────── FlightCard (click plane) ────╮        │ z-30
 *   │            │ United 841 · Boeing 737-924        │        │
 *   │            │ alt 31,000 ft  speed 465 kt …      │        │
 *   │            ╰────────────────────────────────────╯        │
 *   │                                                          │
 *   │        ╭────── LiveMap (fills everything) ──────╮        │ z-0
 *   │        │     live planes + satellites + home    │        │
 *   │        ╰─────────────────────────────────────────╯       │
 *   │                                                          │
 *   │  ╭ OverheadIndicator (if home) ╮                         │ z-20
 *   │  ╰──────────────────────────────╯                        │
 *   └──────────────────────────────────────────────────────────┘
 *
 *   Modals/drawers: HomeSetup, TimelineDrawer, AircraftListPanel,
 *                   SettingsDrawer. All optional — no forced gate.
 *
 * The old home-based pass-logger worker still exists and runs when a
 * home is set. It writes passes to IndexedDB; the TimelineDrawer reads
 * them. But the first-screen experience is dominated by the live map.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSky } from "./state/store";
import { db } from "./lib/db";
import { LiveMap, type LiveMapHandle } from "./components/LiveMap";
import { FlightCard } from "./components/FlightCard";
import { OverheadIndicator } from "./components/OverheadIndicator";
import { AircraftListPanel } from "./components/AircraftListPanel";
import { HomeSetup } from "./components/HomeSetup";
import { TopBar } from "./components/TopBar";
import { TimelineDrawer } from "./components/TimelineDrawer";
import { DetailPanel } from "./components/DetailPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { WelcomeHint } from "./components/WelcomeHint";
import { HelpModal } from "./components/HelpModal";
import { MemoryDrawer } from "./components/MemoryDrawer";
import { getSighting } from "./lib/sightings";
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

  const [showSatellites, setShowSatellites] = useState(false);
  const [homeSetupOpen, setHomeSetupOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [selectedLive, setSelectedLive] = useState<StateVector | null>(null);
  const [aircraft, setAircraft] = useState<readonly StateVector[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const mapRef = useRef<LiveMapHandle | null>(null);

  /* Warm aircraft metadata so FlightCard doesn't flicker. */
  useEffect(() => {
    loadAircraftDb().catch(() => {
      /* non-fatal */
    });
  }, []);

  /* Pass logger worker — only runs when home is set. */
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

  const handleSelectLive = useCallback(
    (s: StateVector | null) => setSelectedLive(s),
    []
  );

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // ignore when typing in inputs
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "s") setShowSatellites((v) => !v);
      else if (e.key === "l") setListOpen((v) => !v);
      else if (e.key === "h") setHomeSetupOpen((v) => !v);
      else if (e.key === "t") setTimelineOpen((v) => !v);
      else if (e.key === "?") setHelpOpen((v) => !v);
      else if (e.key === "m") setMemoryOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-ink-950 text-ink-100">
      <LiveMap
        ref={mapRef}
        onSelectAircraft={handleSelectLive}
        selectedIcao24={selectedLive?.icao24 ?? null}
        showSatellites={showSatellites}
        onAircraftListChange={(list) => {
          setAircraft(list);
          // If the currently-open FlightCard matches a plane in the new
          // poll, refresh its state so altitude/speed/etc tick forward.
          // If the plane has left the bbox, leave the last-known data
          // in place rather than yanking the card closed.
          if (selectedLive) {
            const updated = list.find(
              (s) => s.icao24 === selectedLive.icao24
            );
            if (updated && updated !== selectedLive) setSelectedLive(updated);
          }
        }}
      />

      <TopBar
        showSatellites={showSatellites}
        onToggleSatellites={() => setShowSatellites((v) => !v)}
        onOpenHomeSetup={() => setHomeSetupOpen(true)}
        onOpenTimeline={() => setTimelineOpen(true)}
        onOpenList={() => setListOpen((v) => !v)}
        listOpen={listOpen}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenMemory={() => setMemoryOpen((v) => !v)}
        memoryOpen={memoryOpen}
        onPickRegion={(c, z) => mapRef.current?.flyTo(c, z)}
      />

      <WelcomeHint />

      <OverheadIndicator aircraft={aircraft} onSelect={setSelectedLive} />

      {selectedLive && (
        <FlightCard state={selectedLive} onClose={() => setSelectedLive(null)} />
      )}

      {listOpen && (
        <AircraftListPanel
          aircraft={aircraft}
          selectedIcao24={selectedLive?.icao24 ?? null}
          onSelect={setSelectedLive}
          onClose={() => setListOpen(false)}
        />
      )}

      {memoryOpen && (
        <MemoryDrawer
          onClose={() => setMemoryOpen(false)}
          onSelectIcao24={async (icao24) => {
            const live = aircraft.find((a) => a.icao24 === icao24);
            if (live) {
              setSelectedLive(live);
              setMemoryOpen(false);
              return;
            }
            // Aircraft not in view; synthesize a minimal state from the
            // persisted sighting so the FlightCard can still show its
            // history.
            const s = await getSighting(icao24);
            if (!s) return;
            setSelectedLive({
              icao24: s.icao24,
              callsign: s.lastCallsign,
              originCountry: s.originCountry,
              timePosition: null,
              lastContact: Math.round(s.lastSeenAt / 1000),
              longitude: null,
              latitude: null,
              baroAltitudeM: null,
              onGround: false,
              velocityMps: null,
              trackDeg: null,
              verticalRateMps: null,
              geoAltitudeM: null,
              squawk: null,
              spi: false,
              positionSource: 0,
              category: null,
              _registration: s.registration,
              _typeCode: s.typecode,
              _aircraftDesc: null,
              _operator: s.operator,
            });
            setMemoryOpen(false);
          }}
        />
      )}
      {homeSetupOpen && (
        <HomeSetup
          onDone={() => setHomeSetupOpen(false)}
          onCancel={() => setHomeSetupOpen(false)}
        />
      )}

      {timelineOpen && <TimelineDrawer onClose={() => setTimelineOpen(false)} />}

      <DetailPanel />
      <SettingsDrawer />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
