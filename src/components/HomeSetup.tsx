/**
 * SKYLOG — first-run onboarding.
 *
 * Target: user lands, clicks one button, and within 60 seconds sees a
 * real plane appear. No modal layers, no tours, no email.
 *
 * Two ways to set home:
 *   1. Browser geolocation (requires permission).
 *   2. Click on a MapLibre map.
 *
 * We do NOT send coordinates off the device. This module is rendered
 * only when there is no home yet.
 */

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useSky } from "../state/store";

export function HomeSetup(): JSX.Element {
  const setHome = useSky((s) => s.setHome);
  const [mode, setMode] = useState<"idle" | "locating" | "denied" | "pick">(
    "idle"
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const geolocate = (): void => {
    if (!navigator.geolocation) {
      setErrMsg("Your browser doesn't support geolocation.");
      setMode("denied");
      return;
    }
    setMode("locating");
    setErrMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHome({
          lat: +pos.coords.latitude.toFixed(5),
          lon: +pos.coords.longitude.toFixed(5),
        });
      },
      (err) => {
        setErrMsg(err.message || "Location permission denied.");
        setMode("denied");
      },
      { enableHighAccuracy: false, timeout: 15_000 }
    );
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-ink-950 text-ink-100">
      <div className="w-full max-w-md px-8">
        <h1 className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-ink-400">
          skylog / v0.1
        </h1>
        <h2 className="mt-6 text-3xl font-semibold leading-tight">
          Every plane that flies over your house, on one timeline.
        </h2>
        <p className="mt-4 text-ink-300 leading-relaxed">
          Set your location and SKYLOG begins logging every aircraft that
          passes overhead, with estimated ground-level loudness. Coordinates
          stay on your device.
        </p>

        {mode !== "pick" && (
          <div className="mt-8 space-y-3">
            <button
              onClick={geolocate}
              disabled={mode === "locating"}
              className="block w-full rounded bg-accent px-4 py-3 text-center font-medium text-ink-950 transition hover:bg-accent-soft disabled:opacity-50"
            >
              {mode === "locating" ? "Locating…" : "Use my location"}
            </button>
            <button
              onClick={() => setMode("pick")}
              className="block w-full rounded border border-ink-700 px-4 py-3 text-center text-ink-200 hover:border-ink-500"
            >
              Pick a spot on a map instead
            </button>
            {errMsg && (
              <p className="font-mono text-xs text-accent">{errMsg}</p>
            )}
          </div>
        )}

        {mode === "pick" && (
          <HomePicker
            onPicked={(p) => setHome(p)}
            onCancel={() => setMode("idle")}
          />
        )}

        <p className="mt-10 font-mono text-[0.7rem] uppercase tracking-wider text-ink-500">
          no signup · no tracking · no server
        </p>
      </div>
    </div>
  );
}

interface HomePickerProps {
  onPicked: (p: { lat: number; lon: number }) => void;
  onCancel: () => void;
}

function HomePicker({ onPicked, onCancel }: HomePickerProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(
    null
  );

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      // MapLibre demo tiles — free, no API key, CC-BY OpenMapTiles.
      style: "https://demotiles.maplibre.org/style.json",
      center: [0, 20],
      zoom: 1.5,
      attributionControl: { compact: true },
    });

    let marker: maplibregl.Marker | null = null;
    map.on("click", (e) => {
      const lng = e.lngLat.lng;
      const lat = e.lngLat.lat;
      if (marker) marker.remove();
      marker = new maplibregl.Marker({ color: "#ff8a4c" })
        .setLngLat([lng, lat])
        .addTo(map);
      setPicked({ lat: +lat.toFixed(5), lon: +lng.toFixed(5) });
    });

    return () => {
      map.remove();
    };
  }, []);

  return (
    <div className="mt-8 space-y-3">
      <div
        ref={ref}
        className="h-72 w-full overflow-hidden rounded border border-ink-700"
        aria-label="Pick location on map"
      />
      <div className="flex items-center gap-3">
        <button
          disabled={!picked}
          onClick={() => picked && onPicked(picked)}
          className="flex-1 rounded bg-accent px-4 py-2 text-center font-medium text-ink-950 disabled:opacity-30"
        >
          {picked
            ? `Use ${picked.lat.toFixed(3)}, ${picked.lon.toFixed(3)}`
            : "Click the map to pick"}
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-ink-700 px-3 py-2 text-ink-300 hover:border-ink-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
