/**
 * SKYLOG — help / about overlay. Press "?" to open.
 */

import { useEffect } from "react";

interface HelpOverlayProps {
  onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-md border border-ink-800 bg-ink-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-100">Skylog</h2>
        <p className="mt-2 text-sm text-ink-300">
          Live global aircraft tracker with an on-device loudness model and
          satellite overlay. No account, no tracking, no server — everything
          happens in your browser.
        </p>
        <h3 className="mt-5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
          Shortcuts
        </h3>
        <ul className="mt-2 space-y-1 font-mono text-xs text-ink-200">
          <li>
            <kbd className="mr-2 rounded bg-ink-800 px-1.5 py-0.5">/</kbd>
            search by callsign or ICAO24
          </li>
          <li>
            <kbd className="mr-2 rounded bg-ink-800 px-1.5 py-0.5">?</kbd>
            open this panel
          </li>
          <li>
            <kbd className="mr-2 rounded bg-ink-800 px-1.5 py-0.5">Esc</kbd>
            close any panel
          </li>
        </ul>
        <h3 className="mt-5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
          Data
        </h3>
        <p className="mt-2 text-xs text-ink-300">
          Aircraft positions from{" "}
          <a
            href="https://opensky-network.org/"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            OpenSky Network
          </a>
          , polled every 10 s from your current map view. Satellites from{" "}
          <a
            href="https://celestrak.org/"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            Celestrak
          </a>{" "}
          TLEs, propagated client-side with satellite.js (SGP4). Basemap is
          CartoDB / OpenStreetMap contributors.
        </p>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded border border-ink-700 px-4 py-1.5 text-sm text-ink-200 hover:border-accent hover:text-accent"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
