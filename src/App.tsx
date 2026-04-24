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
import {
  fireNotification,
  ensureNotificationPermission,
} from "./lib/notify";
import { FlightCard } from "./components/FlightCard";
import { OverheadIndicator } from "./components/OverheadIndicator";
import { AircraftListPanel } from "./components/AircraftListPanel";
import { HomeSetup } from "./components/HomeSetup";
import { TopBar } from "./components/TopBar";
import { TimelineDrawer } from "./components/TimelineDrawer";
import { DetailPanel } from "./components/DetailPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { WelcomeHint } from "./components/WelcomeHint";
import { DigestCard } from "./components/DigestCard";
import { HelpModal } from "./components/HelpModal";
import { MemoryDrawer } from "./components/MemoryDrawer";
import { getSighting } from "./lib/sightings";
import { TrackFlightPrompt } from "./components/TrackFlightPrompt";
import { TrackedFlightCard } from "./components/TrackedFlightCard";
import {
  trackCallsign,
  type FlightTracker,
  type TrackedFlightStatus,
} from "./lib/flightTracker";
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
  const [trackPromptOpen, setTrackPromptOpen] = useState(false);
  const [trackedStatus, setTrackedStatus] = useState<TrackedFlightStatus | null>(
    null
  );
  const [following, setFollowing] = useState<boolean>(false);
  const trackerRef = useRef<FlightTracker | null>(null);

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
      else if (e.key === "f") {
        if (trackerRef.current) stopTracking();
        else setTrackPromptOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  const startTracking = async (callsign: string): Promise<void> => {
    stopTracking();
    setFollowing(true);
    // Ask for notification permission in the same user gesture.
    void ensureNotificationPermission();
    const tracker = trackCallsign(callsign, home, (status) => {
      setTrackedStatus(status);
      // Live alert: tracked flight within 5 km of home.
      if (
        status.kind === "live" &&
        status.distanceM != null &&
        status.distanceM <= 5_000
      ) {
        const cs = status.state.callsign ?? status.state.icao24.toUpperCase();
        fireNotification({
          key: `near:${cs}`,
          title: `${cs} is nearly overhead`,
          body:
            status.etaSec != null && status.etaSec > 0
              ? `About ${Math.max(1, Math.round(status.etaSec / 60))} min away.`
              : "Inside 5 km of your home.",
        });
      }
    });
    trackerRef.current = tracker;
    setTrackPromptOpen(false);
  };

  const stopTracking = (): void => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setTrackedStatus(null);
    setFollowing(false);
  };

  useEffect(() => {
    return () => {
      trackerRef.current?.stop();
    };
  }, []);

  // When tracking is active and the 'following' toggle is on, fly the
  // map camera to the tracked plane every time we receive a new fix.
  useEffect(() => {
    if (!following) return;
    if (trackedStatus?.kind !== "live") return;
    const s = trackedStatus.state;
    if (s.latitude == null || s.longitude == null) return;
    mapRef.current?.flyTo([s.longitude, s.latitude], 9);
  }, [trackedStatus, following]);

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
        onOpenTrack={() => setTrackPromptOpen(true)}
        isTracking={trackedStatus != null}
      />

      <DigestCard
        onShowMemory={() => setMemoryOpen(true)}
        onTrackRegular={async (icao24) => {
          // Open the FlightCard for this aircraft — live if we currently
          // see it, else synthesise from the sighting (same as MemoryDrawer).
          const live = aircraft.find((a) => a.icao24 === icao24);
          if (live) {
            setSelectedLive(live);
            return;
          }
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
        }}
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
      {trackPromptOpen && (
        <TrackFlightPrompt
          onStart={startTracking}
          onCancel={() => setTrackPromptOpen(false)}
        />
      )}
      {trackedStatus && (
        <TrackedFlightCard
          status={trackedStatus}
          following={following}
          onToggleFollow={() => setFollowing((v) => !v)}
          onStop={stopTracking}
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
