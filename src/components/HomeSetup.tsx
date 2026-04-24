/**
 * SKYLOG — home location picker.
 *
 * Presented as a modal overlay triggered from the TopBar. Used to be
 * the hard first-run gate; now it's optional — Skylog works fine with
 * no home set (the map still shows planes). Setting a home unlocks the
 * pass-logger + loudness timeline.
 *
 * Two ways to set home:
 *   1. Browser geolocation (asks permission).
 *   2. Click on a mini MapLibre map.
 *
 * Coordinates never leave the device.
 */

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useSky } from "../state/store";

interface HomeSetupProps {
  onDone: () => void;
  onCancel: () => void;
}

export function HomeSetup({ onDone, onCancel }: HomeSetupProps): JSX.Element {
  const setHome = useSky((s) => s.setHome);
  const currentHome = useSky((s) => s.home);
  const [mode, setMode] = useState<"idle" | "locating" | "denied" | "pick">(
    "idle"
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

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
        onDone();
      },
      (err) => {
        setErrMsg(err.message || "Location permission denied.");
        setMode("denied");
      },
      { enableHighAccuracy: false, timeout: 15_000 }
    );
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/70 px-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-md border border-ink-700 bg-ink-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold text-ink-100">Set home location</h2>
        <p className="mt-2 text-sm text-ink-300">
          Skylog logs every plane that passes within your radius and estimates
          ground-level loudness. Coordinates stay on your device.
        </p>

        {mode !== "pick" && (
          <div className="mt-6 space-y-3">
            <button
              onClick={geolocate}
              disabled={mode === "locating"}
              className="block w-full rounded bg-accent px-4 py-2.5 text-center text-sm font-medium text-ink-950 transition hover:bg-accent-soft disabled:opacity-50"
            >
              {mode === "locating" ? "Locating…" : "Use my location"}
            </button>
            <button
              onClick={() => setMode("pick")}
              className="block w-full rounded border border-ink-700 px-4 py-2.5 text-center text-sm text-ink-200 hover:border-ink-500"
            >
              Pick a spot on a map
            </button>
            {errMsg && (
              <p className="font-mono text-xs text-accent">{errMsg}</p>
            )}
          </div>
        )}

        {mode === "pick" && (
          <HomePicker
            onPicked={(p) => {
              setHome(p);
              onDone();
            }}
            onCancel={() => setMode("idle")}
          />
        )}

        <div className="mt-6 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-ink-500">
          <span>
            {currentHome
              ? `current · ${currentHome.lat.toFixed(3)}, ${currentHome.lon.toFixed(3)}`
              : "no home set"}
          </span>
          <button onClick={onCancel} className="hover:text-accent">
            esc to close
          </button>
        </div>
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
    <div className="mt-6 space-y-3">
      <div
        ref={ref}
        className="h-64 w-full overflow-hidden rounded border border-ink-700"
        aria-label="Pick location on map"
      />
      <div className="flex items-center gap-3">
        <button
          disabled={!picked}
          onClick={() => picked && onPicked(picked)}
          className="flex-1 rounded bg-accent px-3 py-2 text-center text-sm font-medium text-ink-950 disabled:opacity-30"
        >
          {picked
            ? `Use ${picked.lat.toFixed(3)}, ${picked.lon.toFixed(3)}`
            : "Click the map to pick"}
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:border-ink-500"
        >
          Back
        </button>
      </div>
    </div>
  );
}
