/**
 * SKYLOG — live mini-map.
 *
 * A small MapLibre-rendered map of the user's radius, with a marker at
 * home and one dot per aircraft currently overhead (last-60s buffer from
 * the worker). Intentionally small — this is a secondary view, the
 * timeline is the hero.
 */

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import { useSky } from "../state/store";
import { rampColor } from "./Timeline";
import { loudnessIntensity } from "../lib/acoustics";

export function LivePanel(): JSX.Element {
  const home = useSky((s) => s.home);
  const radiusMeters = useSky((s) => s.radiusMeters);
  const live = useSky((s) => s.live);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const radiusCircleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !home) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [home.lon, home.lat],
      zoom: 10,
      interactive: true,
      attributionControl: false,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Home marker.
      const el = document.createElement("div");
      el.className =
        "h-3 w-3 rounded-full bg-accent ring-2 ring-ink-950 shadow";
      el.setAttribute("aria-label", "home");
      homeMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([home.lon, home.lat])
        .addTo(map);

      // Radius ring as a GeoJSON circle.
      const circleId = "home-radius";
      radiusCircleRef.current = circleId;
      const poly = circlePolygon(home.lat, home.lon, radiusMeters, 64);
      map.addSource(circleId, {
        type: "geojson",
        data: poly,
      });
      map.addLayer({
        id: circleId + "-fill",
        type: "fill",
        source: circleId,
        paint: { "fill-color": "#ff8a4c", "fill-opacity": 0.05 },
      });
      map.addLayer({
        id: circleId + "-line",
        type: "line",
        source: circleId,
        paint: {
          "line-color": "#ff8a4c",
          "line-width": 1,
          "line-opacity": 0.5,
          "line-dasharray": [2, 2],
        },
      });
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      homeMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // We re-init the map only when home identity changes, not its value
    // in-memory; radius changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home?.lat, home?.lon]);

  // Update radius without re-creating the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !home) return;
    const src = map.getSource(radiusCircleRef.current ?? "") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData(circlePolygon(home.lat, home.lon, radiusMeters, 64));
    }
  }, [home, radiusMeters]);

  // Diff live aircraft to markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const nextIds = new Set(live.map((p) => p.icao24));
    for (const [id, m] of markersRef.current) {
      if (!nextIds.has(id)) {
        m.remove();
        markersRef.current.delete(id);
      }
    }
    for (const a of live) {
      let m = markersRef.current.get(a.icao24);
      const intensity = loudnessIntensity(a.db);
      const color = rampColor(intensity);
      if (!m) {
        const el = document.createElement("div");
        el.className =
          "h-2.5 w-2.5 rounded-full ring-1 ring-ink-950 transition-colors";
        el.style.background = color;
        el.title = a.callsign ?? a.icao24;
        m = new maplibregl.Marker({ element: el, rotationAlignment: "map" })
          .setLngLat([a.lon, a.lat])
          .addTo(map);
        markersRef.current.set(a.icao24, m);
      } else {
        m.setLngLat([a.lon, a.lat]);
        const el = m.getElement();
        el.style.background = color;
      }
    }
  }, [live]);

  const now = useSky((s) => s.liveAt);
  const count = live.length;
  const loudest = useMemo(
    () => live.reduce<number>((acc, a) => Math.max(acc, a.db), 0),
    [live]
  );

  if (!home) return <div />;

  return (
    <div className="relative overflow-hidden rounded border border-ink-700 bg-ink-900">
      <div
        ref={containerRef}
        className="h-56 w-full"
        aria-label="Live mini-map of current overhead aircraft"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-400">
        <span>live · now</span>
        <span>
          {count} overhead · peak {Math.round(loudest)} dB
        </span>
      </div>
      {now === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70 font-mono text-xs text-ink-400">
          warming up…
        </div>
      )}
    </div>
  );
}

/**
 * Construct a GeoJSON polygon approximating a circle of given radius
 * around (lat, lon). Uses equirectangular approximation; at 25 km this
 * introduces sub-meter geometric error, well below map-pixel precision.
 */
function circlePolygon(
  lat: number,
  lon: number,
  radiusM: number,
  vertices: number
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const latDelta = radiusM / 111_320;
  const lonDelta = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= vertices; i++) {
    const theta = (i / vertices) * Math.PI * 2;
    coords.push([
      lon + lonDelta * Math.cos(theta),
      lat + latDelta * Math.sin(theta),
    ]);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [coords] },
    properties: {},
  };
}
