/**
 * SKYLOG — full-screen live aircraft map.
 *
 * Hero component. Renders a MapLibre map that fills the viewport and
 * decorates it with:
 *   - Every ADS-B-equipped aircraft currently in the map's bbox, polled
 *     from OpenSky every 10 s. Each aircraft is a rotated plane glyph,
 *     tinted by altitude, with a trailing line segment showing its
 *     recent path.
 *   - Named satellites (ISS etc.) propagated client-side from Celestrak
 *     TLEs, refreshed once per second.
 *   - Optional home marker + radius ring if the user has set one.
 *   - An altitude legend the user can use to read the colour ramp.
 *
 * Map style is CartoDB's "dark_all" raster — free, reliably hosted,
 * and looks significantly better than MapLibre's demo tiles. We damp
 * the raster a little with low opacity so our overlays stay readable.
 *
 * The map drives the poller: when the user pans or zooms, the next
 * poll uses the new bbox. That turns the app into a "telescope" the
 * user can sweep rather than a fixed dashboard.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl, {
  Map as MlMap,
  Marker as MlMarker,
  StyleSpecification,
} from "maplibre-gl";
import { startLivePoller, type LivePollStatus } from "../lib/livePoller";
import type { StateVector } from "../lib/opensky";
import {
  fetchSatellites,
  propagateAll,
  type SatPosition,
} from "../lib/satellites";
import { useSky } from "../state/store";

/**
 * Pale-yellow → orange → red altitude ramp with a distinct "on ground"
 * tone. We match the rest of the SKYLOG palette so the plane markers
 * feel connected to the timeline colour legend.
 */
export const ALT_COLORS: { band: [number, number]; color: string; label: string }[] = [
  { band: [-500, 1_500], color: "#fde68a", label: "< 1,500 ft" },
  { band: [1_500, 5_000], color: "#fbbf77", label: "1.5k–5k" },
  { band: [5_000, 15_000], color: "#ff8a4c", label: "5k–15k" },
  { band: [15_000, 30_000], color: "#ff5a24", label: "15k–30k" },
  { band: [30_000, 80_000], color: "#c13a1a", label: "> 30k" },
];

function altitudeColor(altM: number | null): string {
  const ft = altM == null ? 0 : altM * 3.28084;
  for (const b of ALT_COLORS) if (ft >= b.band[0] && ft < b.band[1]) return b.color;
  return ALT_COLORS[ALT_COLORS.length - 1]!.color;
}

/**
 * A compact, instantly legible plane silhouette pointing up. We rotate
 * the marker's DOM element to represent heading, so the SVG itself
 * always draws in its canonical "north" orientation.
 */
const PLANE_SVG = (fill: string, selected: boolean): string => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="22" height="22">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path
    filter="${selected ? "url(#glow)" : ""}"
    fill="${fill}" stroke="#1a1a1f" stroke-width="1" stroke-linejoin="round"
    d="M16 2 L19 14 L30 17 L30 20 L19 19 L18 27 L22 29 L22 30 L16 28 L10 30 L10 29 L14 27 L13 19 L2 20 L2 17 L13 14 Z"/>
</svg>`;

const SAT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="26" height="26">
  <g fill="none" stroke="#9ad4ff" stroke-width="1.5" stroke-linejoin="round">
    <rect x="13" y="13" width="6" height="6" fill="#9ad4ff"/>
    <path d="M13 16 L3 11 M13 16 L3 21 M19 16 L29 11 M19 16 L29 21"/>
  </g>
  <circle cx="16" cy="16" r="1.5" fill="#1a1a1f"/>
</svg>`;

/**
 * CartoDB dark_all raster basemap. Free to use with attribution, hosted
 * on a fast CDN, no API key. The saturation/contrast tweaks keep our
 * overlays (plane markers, trails) legible without washing the basemap
 * out entirely.
 */
const STYLE_DARK: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
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
        '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
      minzoom: 0,
      maxzoom: 20,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a0a0b" } },
    {
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: { "raster-opacity": 0.9, "raster-contrast": -0.05 },
    },
  ],
};

interface LiveMapProps {
  onSelectAircraft: (s: StateVector) => void;
  selectedIcao24: string | null;
  showSatellites: boolean;
  focusIcao24: string | null;
  aircraftOut: (s: StateVector[]) => void;
}

interface PlaneMarkerRef {
  marker: MlMarker;
  iconEl: HTMLDivElement;
  latestState: StateVector;
  trail: { lon: number; lat: number; t: number }[];
  lastLonLat: [number, number];
}

export function LiveMap({
  onSelectAircraft,
  selectedIcao24,
  showSatellites,
  focusIcao24,
  aircraftOut,
}: LiveMapProps): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Map<string, PlaneMarkerRef>>(new Map());
  const satMarkersRef = useRef<Map<string, MlMarker>>(new Map());
  const sourcesReady = useRef(false);
  const selectedRef = useRef<string | null>(selectedIcao24);

  const home = useSky((s) => s.home);
  const radiusM = useSky((s) => s.radiusMeters);

  const [status, setStatus] = useState<LivePollStatus>({ kind: "loading" });
  const [aircraftCount, setAircraftCount] = useState<number>(0);
  const [satCount, setSatCount] = useState<number>(0);

  // keep selectedRef in sync so render loop can know the selection without restarting
  useEffect(() => {
    selectedRef.current = selectedIcao24;
    // Re-style the currently-selected marker and the previously-selected one.
    for (const [id, ref] of markersRef.current) {
      const fill = altitudeColor(
        ref.latestState.baroAltitudeM ?? ref.latestState.geoAltitudeM ?? 0
      );
      ref.iconEl.innerHTML = PLANE_SVG(fill, id === selectedIcao24);
      ref.iconEl.style.transform = `rotate(${ref.latestState.trackDeg ?? 0}deg)`;
      ref.iconEl.style.zIndex = id === selectedIcao24 ? "2" : "1";
    }
  }, [selectedIcao24]);

  /* ------- boot map once ------- */
  useEffect(() => {
    if (!container.current) return;
    const initialCenter: [number, number] = home
      ? [home.lon, home.lat]
      : [-73.985, 40.75]; // Midtown NYC — always has planes overhead.
    const initialZoom = home ? 9 : 7.5;
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE_DARK,
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 2,
      maxZoom: 14,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");

    map.on("load", () => {
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
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["get", "age"],
            0,
            0.75,
            60,
            0.05,
          ],
          "line-width": 1.3,
        },
      });
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
          "line-dasharray": [2, 2],
          "line-opacity": 0.55,
          "line-width": 1,
        },
      });
      map.addLayer({
        id: "home-dot",
        type: "circle",
        source: "home-ring",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#ececef",
          "circle-stroke-color": "#1a1a1f",
          "circle-stroke-width": 1,
        },
      });
      sourcesReady.current = true;
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      satMarkersRef.current.clear();
      sourcesReady.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------- fly to a selected flight ------- */
  useEffect(() => {
    if (!focusIcao24 || !mapRef.current) return;
    const ref = markersRef.current.get(focusIcao24);
    if (!ref) return;
    mapRef.current.flyTo({
      center: ref.lastLonLat,
      zoom: Math.max(mapRef.current.getZoom(), 9),
      duration: 900,
    });
  }, [focusIcao24]);

  /* ------- poll OpenSky by current viewport ------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const readBBox = () => {
      const b = map.getBounds();
      return {
        lamin: b.getSouth(),
        lamax: b.getNorth(),
        lomin: b.getWest(),
        lomax: b.getEast(),
      };
    };

    const handleStates = (states: StateVector[]) => {
      renderAircraft(
        map,
        markersRef.current,
        states,
        onSelectAircraft,
        selectedRef,
        sourcesReady
      );
      aircraftOut(states);
    };

    const poller = startLivePoller(readBBox(), handleStates, (s) => {
      setStatus(s);
      if (s.kind === "ok") setAircraftCount(s.count);
      if (s.kind === "empty" || s.kind === "too_wide") setAircraftCount(0);
    });

    const onMoveEnd = () => poller.updateBBox(readBBox());
    map.on("moveend", onMoveEnd);

    return () => {
      poller.stop();
      map.off("moveend", onMoveEnd);
    };
  }, [onSelectAircraft, aircraftOut]);

  /* ------- propagate satellites every second ------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showSatellites) {
      for (const m of satMarkersRef.current.values()) m.remove();
      satMarkersRef.current.clear();
      setSatCount(0);
      return;
    }
    let cancelled = false;
    let tles: Awaited<ReturnType<typeof fetchSatellites>> = [];
    let interval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        tles = await fetchSatellites("stations");
      } catch {
        return; // Silently drop if Celestrak blocks the call; map still works.
      }
      if (cancelled) return;
      const tick = () => {
        if (cancelled) return;
        const positions = propagateAll(tles, new Date());
        renderSatellites(map, satMarkersRef.current, positions);
        setSatCount(positions.length);
      };
      tick();
      interval = setInterval(tick, 1000);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [showSatellites]);

  /* ------- draw home marker + radius ring when home changes ------- */
  useEffect(() => {
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
  }, [home, radiusM, status]);

  const toggleLegend = useCallback(() => {
    /* reserved: toggling visibility could go here */
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={container} className="absolute inset-0" />
      <StatusBadge
        status={status}
        aircraftCount={aircraftCount}
        satCount={showSatellites ? satCount : null}
      />
      <AltitudeLegend onToggle={toggleLegend} />
    </div>
  );
}

/* ---------- helpers ---------- */

function ringCoords(lat: number, lon: number, radiusM: number): [number, number][] {
  const coords: [number, number][] = [];
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

function renderAircraft(
  map: MlMap,
  markers: Map<string, PlaneMarkerRef>,
  states: StateVector[],
  onSelect: (s: StateVector) => void,
  selectedRef: React.MutableRefObject<string | null>,
  sourcesReady: React.MutableRefObject<boolean>
): void {
  const seen = new Set<string>();
  const now = Date.now();

  for (const s of states) {
    if (s.latitude == null || s.longitude == null) continue;
    seen.add(s.icao24);
    const heading = s.trackDeg ?? 0;
    const color = altitudeColor(s.baroAltitudeM ?? s.geoAltitudeM ?? 0);
    const selected = selectedRef.current === s.icao24;
    const existing = markers.get(s.icao24);

    if (existing) {
      existing.marker.setLngLat([s.longitude, s.latitude]);
      existing.iconEl.innerHTML = PLANE_SVG(color, selected);
      existing.iconEl.style.transform = `rotate(${heading}deg)`;
      existing.iconEl.style.zIndex = selected ? "2" : "1";
      if (
        existing.lastLonLat[0] !== s.longitude ||
        existing.lastLonLat[1] !== s.latitude
      ) {
        existing.trail.push({ lon: s.longitude, lat: s.latitude, t: now });
        if (existing.trail.length > 6) existing.trail.shift();
      }
      existing.latestState = s;
      existing.lastLonLat = [s.longitude, s.latitude];
    } else {
      const iconEl = document.createElement("div");
      iconEl.innerHTML = PLANE_SVG(color, selected);
      iconEl.style.cssText = `
        width:22px;height:22px;cursor:pointer;
        transition:transform 350ms linear;
        transform:rotate(${heading}deg);
        filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));
        z-index:${selected ? 2 : 1};
      `;
      iconEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelect(s);
      });
      const marker = new maplibregl.Marker({ element: iconEl })
        .setLngLat([s.longitude, s.latitude])
        .addTo(map);
      markers.set(s.icao24, {
        marker,
        iconEl,
        latestState: s,
        trail: [{ lon: s.longitude, lat: s.latitude, t: now }],
        lastLonLat: [s.longitude, s.latitude],
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

  // Rebuild trail geojson with per-segment age so the paint expression fades older segments.
  if (sourcesReady.current) {
    const features: GeoJSON.Feature[] = [];
    for (const ref of markers.values()) {
      if (ref.trail.length < 2) continue;
      for (let i = 1; i < ref.trail.length; i++) {
        const prev = ref.trail[i - 1]!;
        const cur = ref.trail[i]!;
        const ageSec = (now - cur.t) / 1000;
        features.push({
          type: "Feature",
          properties: { age: ageSec },
          geometry: {
            type: "LineString",
            coordinates: [
              [prev.lon, prev.lat],
              [cur.lon, cur.lat],
            ],
          },
        });
      }
    }
    const src = map.getSource("trails") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }
}

function renderSatellites(
  map: MlMap,
  markers: Map<string, MlMarker>,
  positions: SatPosition[]
): void {
  const seen = new Set<string>();
  for (const p of positions) {
    seen.add(p.id);
    const existing = markers.get(p.id);
    if (existing) {
      existing.setLngLat([p.lon, p.lat]);
    } else {
      const el = document.createElement("div");
      el.innerHTML = SAT_SVG;
      el.style.cssText = `
        width:26px;height:26px;opacity:0.95;
        filter:drop-shadow(0 0 8px rgba(154,212,255,0.35));
      `;
      el.title = `${p.name} — ${Math.round(p.altKm)} km, ${p.speedKmS.toFixed(1)} km/s`;
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
      markers.set(p.id, m);
    }
  }
  for (const [id, m] of markers) {
    if (!seen.has(id)) {
      m.remove();
      markers.delete(id);
    }
  }
}

function StatusBadge({
  status,
  aircraftCount,
  satCount,
}: {
  status: LivePollStatus;
  aircraftCount: number;
  satCount: number | null;
}): JSX.Element {
  const color =
    status.kind === "rate_limited" || status.kind === "error"
      ? "text-accent"
      : status.kind === "loading"
      ? "text-ink-400"
      : "text-ink-200";
  const text =
    status.kind === "loading"
      ? "Loading aircraft…"
      : status.kind === "ok"
      ? `${aircraftCount} aircraft in view`
      : status.kind === "empty"
      ? "No aircraft in view — try panning somewhere busy"
      : status.kind === "too_wide"
      ? "Zoom in to load aircraft"
      : status.kind === "rate_limited"
      ? "OpenSky rate-limited — retrying"
      : status.kind === "offline"
      ? "Offline"
      : `Error: ${status.message}`;

  return (
    <div className="pointer-events-none absolute left-4 bottom-16 z-10 flex flex-col gap-1">
      <div className={`rounded bg-ink-900/85 px-3 py-2 font-mono text-xs backdrop-blur ${color}`}>
        {text}
      </div>
      {satCount != null && (
        <div className="rounded bg-ink-900/85 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[#9ad4ff] backdrop-blur">
          {satCount} satellite{satCount === 1 ? "" : "s"} visible
        </div>
      )}
    </div>
  );
}

function AltitudeLegend({ onToggle: _onToggle }: { onToggle: () => void }): JSX.Element {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded bg-ink-900/85 px-3 py-2 backdrop-blur">
      <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-ink-500">
        altitude
      </p>
      <div className="flex items-center gap-1.5">
        {ALT_COLORS.map((b) => (
          <div key={b.label} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: b.color }}
            />
            <span className="font-mono text-[9px] text-ink-400">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
