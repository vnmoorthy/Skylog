/**
 * SKYLOG — full-screen live aircraft map (hero component).
 *
 * What it does:
 *   1. Boots a MapLibre GL map with a dark OSM raster basemap (Mapbox-
 *      style dark aesthetic, no access token needed).
 *   2. Spins up a viewport-bound OpenSky poller; when the user pans or
 *      zooms, the next poll reflects the new bbox.
 *   3. For every aircraft returned, maintains a pooled DOM-marker that
 *      holds a rotated SVG plane, tinted by altitude.
 *   4. Runs a 10 Hz requestAnimationFrame loop that dead-reckons each
 *      marker between polls using velocity + track, so the planes move
 *      smoothly instead of teleporting every 10 s.
 *   5. Renders short (~60 s) trails behind each aircraft via a single
 *      GeoJSON source + line layer.
 *   6. Draws the user's home marker + radius ring (if set).
 *   7. Optionally overlays satellites (ISS etc.) propagated client-side
 *      from Celestrak TLEs.
 *   8. Click a plane → hands the StateVector up to App for the detail
 *      card. Click the map background → clears selection.
 *   9. Broadcasts aircraft lists upward for the list panel + overhead
 *      indicator to consume.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import maplibregl, {
  Map as MlMap,
  Marker as MlMarker,
} from "maplibre-gl";
import { startLivePoller, type LivePollStatus } from "../lib/livePoller";
import type { BBox } from "../lib/geo";
import type { StateVector } from "../lib/opensky";
// Satellite helpers are loaded lazily inside the satellite useEffect to
// keep the initial bundle small. The types are still referenced at compile
// time but tsc will strip them at runtime.
import type { ParsedSat, SatPosition } from "../lib/satellites";
import { extrapolate } from "../lib/deadReckon";
import { recordSightings } from "../lib/sightings";
import { statePassesFilter, type AltitudeBand, type CategoryFilter } from "./FilterBar";
import { useSky } from "../state/store";

interface LiveMapProps {
  onSelectAircraft: (s: StateVector | null) => void;
  selectedIcao24: string | null;
  showSatellites: boolean;
  onAircraftListChange: (list: readonly StateVector[]) => void;
  /** When > 0, replay the sky from (now - replayOffsetSec) instead of now. */
  replayOffsetSec: number;
  altitudeBand: AltitudeBand;
  categoryFilter: CategoryFilter;
}

interface PlaneMarkerRef {
  marker: MlMarker;
  iconEl: HTMLDivElement;
  state: StateVector;
  anchorAt: number;
  trail: Array<[number, number, number]>; // [lon, lat, ts]
  /** Last colour applied to the icon — used to avoid re-styling when unchanged. */
  lastColor: string;
  /** Last heading in degrees — used to skip tiny transform updates. */
  lastHeading: number;
  /** Timestamp of the last position update — for time-machine replay. */
  lastAt: number;
}

interface SatMarkerRef {
  marker: MlMarker;
  iconEl: HTMLDivElement;
}

/* -------------------- visual constants -------------------- */

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0a0a0b" },
    },
    {
      id: "basemap",
      type: "raster",
      source: "basemap",
    },
  ],
};

// Stable SVG string — we set the fill via inline `color:` on the host div
// using SVG's currentColor. This lets us swap colours on altitude change
// without replacing the DOM subtree (which kills the CSS transition
// state and makes the markers flicker every poll).
const PLANE_SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
  <path fill="currentColor" stroke="#06060a" stroke-width="1.1" stroke-linejoin="round"
        d="M16 2 L19 14 L30 17 L30 20 L19 19 L18 27 L22 29 L22 30 L16 28 L10 30 L10 29 L14 27 L13 19 L2 20 L2 17 L13 14 Z"/>
</svg>`;

const SAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
  <g fill="none" stroke="#9ad4ff" stroke-width="1.6" stroke-linejoin="round">
    <rect x="13" y="13" width="6" height="6" fill="#9ad4ff"/>
    <path d="M13 16 L4 12 M13 16 L4 20 M19 16 L28 12 M19 16 L28 20"/>
  </g>
  <circle cx="16" cy="16" r="1.5" fill="#06060a"/>
</svg>`;

/** Altitude → colour ramp. Cool for taxiing / low, warm for cruise. */
function altitudeColor(altM: number | null): string {
  const ft = altM == null ? 0 : altM * 3.28084;
  if (ft < 500) return "#9ad4ff";
  if (ft < 2_500) return "#fbbf77";
  if (ft < 10_000) return "#ffa357";
  if (ft < 20_000) return "#ff8a4c";
  if (ft < 30_000) return "#ff6b35";
  return "#ef4c24";
}

const HOVER_GLOW = "drop-shadow(0 0 6px rgba(255,138,76,0.8))";
const BASE_GLOW = "drop-shadow(0 1px 2px rgba(0,0,0,0.55))";

/* -------------------- component -------------------- */

export interface LiveMapHandle {
  flyTo: (center: [number, number], zoom: number) => void;
}

export const LiveMap = forwardRef<LiveMapHandle, LiveMapProps>(function LiveMap(
  { onSelectAircraft, selectedIcao24, showSatellites, onAircraftListChange, replayOffsetSec, altitudeBand, categoryFilter },
  ref
): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Map<string, PlaneMarkerRef>>(new Map());
  const satMarkersRef = useRef<Map<string, SatMarkerRef>>(new Map());
  const sourcesReady = useRef(false);
  const rafRef = useRef<number | null>(null);
  const replayRef = useRef<number>(0);

  const home = useSky((s) => s.home);
  const radiusM = useSky((s) => s.radiusMeters);

  const [status, setStatus] = useState<LivePollStatus>({ kind: "loading" });
  const [aircraftCount, setAircraftCount] = useState(0);
  const [satCount, setSatCount] = useState(0);

  useImperativeHandle(ref, () => ({
    flyTo: (center, zoom) => {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center, zoom, duration: 1500, essential: true });
    },
  }), []);

  /* -------------------- boot map -------------------- */
  useEffect(() => {
    if (!container.current) return;

    const initialCenter: [number, number] = home
      ? [home.lon, home.lat]
      : [-0.1276, 51.5074]; // London — prime meridian, busiest corridor.
    const initialZoom = home ? 9 : 8;

    const map = new maplibregl.Map({
      container: container.current,
      style: DARK_STYLE,
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 2,
      maxZoom: 14,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    (window as unknown as { __skylogMap?: MlMap }).__skylogMap = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");

    // MapLibre occasionally latches onto a stale container size when
    // mounted inside a React tree that re-lays out during hydration,
    // leaving the WebGL canvas blank. We combat that with three
    // independent kicks:
    //   1. A fast 100 ms repaint poll for the first 12 s of map life.
    //      Noisy but deterministic — one of those ticks always lands
    //      on a frame where the canvas has its final dimensions.
    //   2. A sourcedata event listener that forces a resize/repaint
    //      when the first basemap tile finishes loading.
    //   3. A ResizeObserver on the container div (below), so later
    //      window resizes keep the canvas sharp.
    const kickMap = (): void => {
      const m = mapRef.current;
      if (!m) return;
      m.resize();
      m.triggerRepaint();
    };
    const bootPoll = setInterval(kickMap, 100);
    const stopBootPoll = setTimeout(() => {
      clearInterval(bootPoll);
      const m = mapRef.current;
      if (m) {
        m.jumpTo({ center: initialCenter, zoom: initialZoom });
        // Pan-jiggle: a 1-pixel pan and back forces MapLibre to
        // re-evaluate which tiles it needs for the *current* canvas
        // size. Without this, on slow boots the map renders only the
        // tiles it had decided on at 0×0 canvas and never recovers.
        m.panBy([1, 0], { duration: 0 });
        m.panBy([-1, 0], { duration: 0 });
        m.fire("moveend");
      }
    }, 12_000);
    const onSourceData = (): void => {
      // First basemap tile arrival — flush a resize in case the
      // canvas was mis-sized when the map first rendered.
      kickMap();
    };
    map.on("sourcedata", onSourceData);
    // Also run a couple of explicit kicks on the next paint frames,
    // covering the very first render where the container might still
    // be laying out.
    requestAnimationFrame(() => {
      kickMap();
      requestAnimationFrame(kickMap);
    });
    // ResizeObserver keeps the canvas sharp through later window resizes.
    const ro = new ResizeObserver(() => {
      const m = mapRef.current;
      if (!m) return;
      m.resize();
      m.triggerRepaint();
    });
    if (container.current) ro.observe(container.current);
    map.on("error", (e) => {
      // eslint-disable-next-line no-console
      console.warn("MapLibre:", e);
    });

    map.on("load", () => {
      // Trails: one GeoJSON source, one line layer.
      map.addSource("trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "trails",
        type: "line",
        source: "trails",
        paint: {
          "line-color": "#ff8a4c",
          "line-opacity": 0.45,
          "line-width": 1.1,
        },
      });

      // Projected heading line for the currently-selected aircraft.
      map.addSource("projection", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "projection",
        type: "line",
        source: "projection",
        paint: {
          "line-color": "#ff8a4c",
          "line-opacity": 0.8,
          "line-width": 2,
          "line-dasharray": [2, 2],
        },
      });

      // Satellite ground-track preview (only populated when one is selected).
      map.addSource("sat-track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "sat-track",
        type: "line",
        source: "sat-track",
        paint: {
          "line-color": "#9ad4ff",
          "line-opacity": 0.5,
          "line-width": 1,
          "line-dasharray": [1, 2],
        },
      });

      // Home + radius ring.
      map.addSource("home-ring", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "home-ring",
        type: "line",
        source: "home-ring",
        paint: {
          "line-color": "#ff8a4c",
          "line-opacity": 0.6,
          "line-width": 1,
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "home-dot",
        type: "circle",
        source: "home-ring",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": "#fafafa",
          "circle-radius": 3.5,
          "circle-stroke-color": "#ff8a4c",
          "circle-stroke-width": 2,
        },
      });

      sourcesReady.current = true;
      rebuildHomeRing();
    });

    map.on("click", () => {
      onSelectAircraft(null);
    });

    return () => {
      clearInterval(bootPoll);
      clearTimeout(stopBootPoll);
      map.off("sourcedata", onSourceData);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      satMarkersRef.current.clear();
      sourcesReady.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------- silent geolocation fly-to -------------------- */
  // If the user has no home set, try a passive geolocation request. If the
  // browser grants it, fly the map to the user so they immediately see
  // their local airspace. If denied, we stay at the London default. This is
  // strictly UX-only — it does not set a home.
  useEffect(() => {
    if (home) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 9,
          duration: 1_400,
          essential: true,
        });
      },
      () => {
        /* denied or unavailable — stay on default */
      },
      { enableHighAccuracy: false, timeout: 6_000, maximumAge: 10 * 60_000 }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------- poll live feed -------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const readBBox = (): BBox => {
      const b = map.getBounds();
      return {
        lamin: b.getSouth(),
        lomin: b.getWest(),
        lamax: b.getNorth(),
        lomax: b.getEast(),
      };
    };

    const handleStates = (states: StateVector[]): void => {
      // Always record every sighting (memory should be unbiased by UI filters).
      void recordSightings(states);
      // Always pass the full list to App so the list panel + overhead show truth.
      onAircraftListChange(states);
      // But apply UI filter to what's drawn on the map.
      const visible = states.filter((s) =>
        statePassesFilter(s, altitudeBand, categoryFilter)
      );
      applyPoll(map, markersRef.current, visible, onSelectAircraft);
      setAircraftCount(visible.length);
    };

    const poller = startLivePoller(readBBox(), handleStates, setStatus);
    const onMoveEnd = (): void => poller.updateBBox(readBBox());
    map.on("moveend", onMoveEnd);

    return () => {
      poller.stop();
      map.off("moveend", onMoveEnd);
    };
  }, [onSelectAircraft, onAircraftListChange, altitudeBand, categoryFilter]);

  // Keep the replay ref in sync with the prop so the rAF loop sees fresh values.
  useEffect(() => {
    replayRef.current = replayOffsetSec;
  }, [replayOffsetSec]);

  /* -------------------- animation loop -------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let lastFrame = 0;
    const step = (now: number): void => {
      if (now - lastFrame > 100) {
        lastFrame = now;
        tickDeadReckoning(map, markersRef.current, sourcesReady, selectedIcao24, replayRef.current);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [selectedIcao24]);

  /* -------------------- satellites overlay -------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showSatellites) {
      for (const ref of satMarkersRef.current.values()) ref.marker.remove();
      satMarkersRef.current.clear();
      setSatCount(0);
      clearSatTrack(map);
      return;
    }
    let cancelled = false;
    let sats: ParsedSat[] = [];
    let selectedSatId: string | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      // Dynamic import: pulls satellite.js + the satellites helpers into
      // a separate chunk that only loads when the user toggles satellites.
      const satMod = await import("../lib/satellites").catch(() => null);
      if (!satMod || cancelled) return;
      try {
        sats = await satMod.fetchSatellites("stations");
      } catch {
        return;
      }
      if (cancelled) return;
      const tick = (): void => {
        if (cancelled) return;
        const positions = satMod.propagateAll(sats, new Date());
        renderSatellites(
          map,
          satMarkersRef.current,
          positions,
          sats,
          (satId) => {
            selectedSatId = satId;
            const selected = sats.find((s) => s.id === satId);
            if (selected) drawSatTrack(map, selected, satMod.groundTrack);
          }
        );
        if (selectedSatId) {
          const sel = sats.find((s) => s.id === selectedSatId);
          if (sel) drawSatTrack(map, sel, satMod.groundTrack);
        }
        setSatCount(positions.length);
      };
      tick();
      timer = setInterval(tick, 1000);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [showSatellites]);

  /* -------------------- home ring sync -------------------- */
  const rebuildHomeRing = useMemo(() => {
    return () => {
      const map = mapRef.current;
      if (!map || !sourcesReady.current) return;
      const src = map.getSource("home-ring") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      if (!home) {
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [home.lon, home.lat] },
          },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: ringCoords(home.lat, home.lon, radiusM),
            },
          },
        ],
      });
    };
  }, [home, radiusM]);

  useEffect(() => {
    rebuildHomeRing();
  }, [home, radiusM, status, rebuildHomeRing]);

  /* -------------------- render -------------------- */
  return (
    <div className="absolute inset-0">
      <div ref={container} className="absolute inset-0" />
      <StatusBadge
        status={status}
        aircraftCount={aircraftCount}
        satCount={showSatellites ? satCount : null}
      />
    </div>
  );
});

/* -------------------- pure helpers -------------------- */

function ringCoords(lat: number, lon: number, radiusM: number): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  const n = 64;
  const R = 6_371_008.7714;
  const latRad = (lat * Math.PI) / 180;
  const d = radiusM / R;
  for (let i = 0; i <= n; i++) {
    const b = (i / n) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(b)
    );
    const lon2 =
      (lon * Math.PI) / 180 +
      Math.atan2(
        Math.sin(b) * Math.sin(d) * Math.cos(latRad),
        Math.cos(d) - Math.sin(latRad) * Math.sin(lat2)
      );
    coords.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return coords;
}

function applyPoll(
  map: MlMap,
  markers: Map<string, PlaneMarkerRef>,
  states: StateVector[],
  onSelect: (s: StateVector | null) => void
): void {
  const seen = new Set<string>();
  const now = Date.now();
  for (const s of states) {
    if (s.latitude == null || s.longitude == null) continue;
    seen.add(s.icao24);
    const heading = s.trackDeg ?? 0;
    const color = altitudeColor(s.baroAltitudeM ?? s.geoAltitudeM ?? 0);

    const existing = markers.get(s.icao24);
    if (existing) {
      // Update position.
      existing.marker.setLngLat([s.longitude, s.latitude]);
      // Only re-style the fill if the altitude-color changed.
      if (existing.lastColor !== color) {
        existing.iconEl.style.color = color;
        existing.lastColor = color;
      }
      // Only update the rotation if heading actually changed meaningfully
      // (>2°). Re-assigning the same value can interrupt the CSS transition.
      const headingDelta = Math.abs(((heading - existing.lastHeading + 540) % 360) - 180);
      if (headingDelta > 2) {
        existing.iconEl.style.transform = `rotate(${heading}deg)`;
        existing.lastHeading = heading;
      }
      // Extend the trail only when the plane actually moved (≈10 m).
      const last = existing.trail[existing.trail.length - 1];
      if (!last || Math.hypot(last[0] - s.longitude, last[1] - s.latitude) > 0.0001) {
        existing.trail.push([s.longitude, s.latitude, now]);
        if (existing.trail.length > 60) existing.trail.shift();
      }
      existing.lastAt = now;
      existing.state = s;
      existing.anchorAt = now;
    } else {
      const iconEl = document.createElement("div");
      iconEl.innerHTML = PLANE_SVG_MARKUP;
      iconEl.style.cssText = `
        width:22px;height:22px;cursor:pointer;
        color:${color};
        transition:transform 400ms linear, color 300ms ease;
        transform:rotate(${heading}deg);
        filter:${BASE_GLOW};
      `;
      iconEl.setAttribute("role", "button");
      iconEl.setAttribute("aria-label", s.callsign?.trim() || s.icao24);
      iconEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelect(s);
      });
      iconEl.addEventListener("mouseenter", () => {
        iconEl.style.filter = `${BASE_GLOW} ${HOVER_GLOW}`;
      });
      iconEl.addEventListener("mouseleave", () => {
        iconEl.style.filter = BASE_GLOW;
      });
      const marker = new maplibregl.Marker({ element: iconEl })
        .setLngLat([s.longitude, s.latitude])
        .addTo(map);
      markers.set(s.icao24, {
        marker,
        iconEl,
        state: s,
        anchorAt: now,
        trail: [[s.longitude, s.latitude, now]],
        lastColor: color,
        lastHeading: heading,
        lastAt: now,
      });
    }
  }
  // Remove stale markers.
  for (const [id, ref] of markers) {
    if (!seen.has(id)) {
      ref.marker.remove();
      markers.delete(id);
    }
  }
}

function tickDeadReckoning(
  map: MlMap,
  markers: Map<string, PlaneMarkerRef>,
  sourcesReady: React.MutableRefObject<boolean>,
  selectedIcao24: string | null,
  replayOffsetSec: number = 0
): void {
  const now = Date.now();
  const replayAt = replayOffsetSec > 0 ? now - replayOffsetSec * 1000 : 0;
  const features: GeoJSON.Feature[] = [];

  for (const ref of markers.values()) {
    const s = ref.state;
    if (s.latitude == null || s.longitude == null) continue;
    if (replayAt > 0) {
      // Replay mode: position each marker at the trail sample nearest to replayAt.
      const sample = nearestTrailSample(ref.trail, replayAt);
      if (sample) {
        ref.marker.setLngLat([sample[0], sample[1]]);
        // Dim aged markers a touch so user can tell live vs replay.
        ref.iconEl.style.opacity = "0.85";
      } else {
        // No trail data that old — hide the marker for the duration of the replay frame.
        ref.iconEl.style.opacity = "0.15";
      }
    } else {
      ref.iconEl.style.opacity = "1";
      if (s.velocityMps != null && s.trackDeg != null && s.velocityMps > 0 && !s.onGround) {
        const [newLat, newLon] = extrapolate(
          {
            lat: s.latitude,
            lon: s.longitude,
            speedMps: s.velocityMps,
            trackDeg: s.trackDeg,
            anchorAt: ref.anchorAt,
          },
          now
        );
        ref.marker.setLngLat([newLon, newLat]);
      }
    }
    // Highlight the selected plane.
    const isSelected = selectedIcao24 != null && s.icao24 === selectedIcao24;
    ref.iconEl.style.filter = isSelected
      ? `${BASE_GLOW} ${HOVER_GLOW} drop-shadow(0 0 10px rgba(255,138,76,0.6))`
      : BASE_GLOW;

    if (ref.trail.length >= 2) {
      features.push({
        type: "Feature",
        properties: {
          icao24: s.icao24,
          selected: isSelected,
        },
        geometry: {
          type: "LineString",
          coordinates: ref.trail.map((p) => [p[0], p[1]]),
        },
      });
    }
  }

  if (sourcesReady.current) {
    const src = map.getSource("trails") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });

    // Update the projection line for the selected aircraft.
    const projSrc = map.getSource("projection") as maplibregl.GeoJSONSource | undefined;
    if (projSrc) {
      let projData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      if (selectedIcao24) {
        const ref = markers.get(selectedIcao24);
        if (
          ref &&
          ref.state.latitude != null &&
          ref.state.longitude != null &&
          ref.state.velocityMps != null &&
          ref.state.trackDeg != null &&
          ref.state.velocityMps > 0
        ) {
          // 5-minute heading projection.
          const distM = ref.state.velocityMps * 300;
          const trackRad = (ref.state.trackDeg * Math.PI) / 180;
          const dLatM = Math.cos(trackRad) * distM;
          const dLonM = Math.sin(trackRad) * distM;
          const dLat = dLatM / 111_320;
          const dLon =
            dLonM /
            Math.max(0.001, 111_320 * Math.cos((ref.state.latitude * Math.PI) / 180));
          const target: [number, number] = [
            ref.state.longitude + dLon,
            ref.state.latitude + dLat,
          ];
          // Live (or replay) position is what the marker is rendering.
          const here = ref.marker.getLngLat();
          projData = {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: [[here.lng, here.lat], target],
                },
              },
            ],
          };
        }
      }
      projSrc.setData(projData);
    }
  }
}

function renderSatellites(
  map: MlMap,
  markers: Map<string, SatMarkerRef>,
  positions: SatPosition[],
  _sats: ParsedSat[],
  onSelect: (satId: string) => void
): void {
  const seen = new Set<string>();
  for (const p of positions) {
    seen.add(p.id);
    const existing = markers.get(p.id);
    if (existing) {
      existing.marker.setLngLat([p.lon, p.lat]);
      existing.iconEl.title = `${p.name} · ${Math.round(p.altKm)} km · ${p.speedKmS.toFixed(1)} km/s`;
    } else {
      const el = document.createElement("div");
      el.innerHTML = SAT_SVG;
      el.style.cssText = `
        width:22px;height:22px;cursor:pointer;opacity:0.95;
        filter:drop-shadow(0 0 7px rgba(154,212,255,0.45));
      `;
      el.title = `${p.name} · ${Math.round(p.altKm)} km · ${p.speedKmS.toFixed(1)} km/s`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelect(p.id);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
      markers.set(p.id, { marker, iconEl: el });
    }
  }
  for (const [id, ref] of markers) {
    if (!seen.has(id)) {
      ref.marker.remove();
      markers.delete(id);
    }
  }
}

function drawSatTrack(
  map: MlMap,
  sat: ParsedSat,
  groundTrack: (sat: ParsedSat, fromMs: number, steps: number, stepMs: number) => Array<[number, number]>
): void {
  const now = Date.now();
  const stepMs = 30_000;
  const stepsAhead = 180; // 90 min
  const past = groundTrack(sat, now - stepsAhead * stepMs, stepsAhead, stepMs);
  const future = groundTrack(sat, now, stepsAhead, stepMs);
  const src = map.getSource("sat-track") as maplibregl.GeoJSONSource | undefined;
  src?.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { when: "past" },
        geometry: { type: "LineString", coordinates: past },
      },
      {
        type: "Feature",
        properties: { when: "future" },
        geometry: { type: "LineString", coordinates: future },
      },
    ],
  });
}

function clearSatTrack(map: MlMap): void {
  const src = map.getSource("sat-track") as maplibregl.GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features: [] });
}

/* -------------------- status badge -------------------- */

function StatusBadge({
  status,
  aircraftCount,
  satCount,
}: {
  status: LivePollStatus;
  aircraftCount: number;
  satCount: number | null;
}): JSX.Element {
  const tone =
    status.kind === "rate_limited" || status.kind === "error" || status.kind === "offline"
      ? "text-accent"
      : status.kind === "loading"
      ? "text-ink-400"
      : status.kind === "delayed"
      ? "text-ink-300"
      : "text-ink-200";

  let text: string;
  switch (status.kind) {
    case "loading":
      text = "Loading aircraft…";
      break;
    case "ok":
      text = `${aircraftCount} aircraft in view`;
      break;
    case "empty":
      text = "No aircraft in view — pan or zoom to busier airspace";
      break;
    case "delayed": {
      const ago = Math.max(1, Math.round((Date.now() - status.lastGoodAt) / 1000));
      text = `${status.lastCount} aircraft · live feed delayed (${ago}s)`;
      break;
    }
    case "too_wide":
      text = "Zoom in to load aircraft";
      break;
    case "rate_limited":
      text = "Live feed rate-limited — retrying";
      break;
    case "offline":
      text = "Offline";
      break;
    case "error":
      text = `Error: ${status.message}`;
      break;
  }

  return (
    <div
      className="pointer-events-none absolute left-4 top-20 z-10 flex flex-col gap-1.5"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className={`rounded bg-ink-900/85 px-3 py-1.5 font-mono text-xs backdrop-blur ${tone}`}>
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full" style={{ background: dotColor(status.kind), boxShadow: `0 0 6px ${dotColor(status.kind)}`}} />
        {text}
      </div>
      {satCount != null && (
        <div className="rounded bg-ink-900/85 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[#9ad4ff] backdrop-blur">
          {satCount} satellite{satCount === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

function dotColor(kind: LivePollStatus["kind"]): string {
  switch (kind) {
    case "ok":
      return "#43e27a";
    case "empty":
      return "#8a8a96";
    case "delayed":
    case "too_wide":
      return "#fbbf77";
    case "rate_limited":
    case "error":
    case "offline":
      return "#ff4c24";
    case "loading":
    default:
      return "#8a8a96";
  }
}


/** Find the trail sample whose timestamp is closest to `at`. */
function nearestTrailSample(
  trail: Array<[number, number, number]>,
  at: number
): [number, number, number] | null {
  if (trail.length === 0) return null;
  let best = trail[0]!;
  let bestDelta = Math.abs(best[2] - at);
  for (let i = 1; i < trail.length; i++) {
    const d = Math.abs(trail[i]![2] - at);
    if (d < bestDelta) {
      best = trail[i]!;
      bestDelta = d;
    }
  }
  return best;
}
