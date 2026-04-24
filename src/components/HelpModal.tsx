/**
 * SKYLOG — help / about modal.
 *
 * Press ? to open. Explains the product, keyboard shortcuts, data
 * sources, and privacy stance. Intentionally short — the map is the
 * product, not the docs.
 */

import { useEffect } from "react";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 px-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-md border border-ink-700 bg-ink-900 p-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
              skylog · v0.2
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              Live plane &amp; satellite tracker
            </h2>
          </div>
          <button onClick={onClose} className="font-mono text-[11px] text-ink-400 hover:text-accent">
            ESC ×
          </button>
        </div>
        <p className="mt-4 text-sm text-ink-300">
          Every orange triangle on the map is a real aircraft, reporting its
          position over ADS-B. Data comes from{" "}
          <a
            href="https://opensky-network.org"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            OpenSky Network
          </a>
          . Click a plane for its registration, type, and altitude. Set a home
          location to log passes over time and estimate ground-level loudness.
          Toggle satellites for the ISS and other Celestrak stations.
        </p>

        <section className="mt-6">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            keyboard shortcuts
          </h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
            <Shortcut k="s" label="toggle satellites" />
            <Shortcut k="l" label="toggle aircraft list" />
            <Shortcut k="h" label="open home setup" />
            <Shortcut k="t" label="open timeline (if home is set)" />
            <Shortcut k="?" label="show this help" />
            <Shortcut k="esc" label="close the active panel" />
          </dl>
        </section>

        <section className="mt-6">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            privacy
          </h3>
          <p className="mt-2 text-xs text-ink-300">
            There is no backend. No account. No tracker. Your location, if
            you share it, stays in your browser's storage. Rolling buffer of
            up to 72 hours of passes lives in IndexedDB on your machine.
          </p>
        </section>

        <p className="mt-6 font-mono text-[10px] uppercase tracking-wider text-ink-500">
          built with · opensky · carto · maplibre · dexie · satellite.js
        </p>
      </div>
    </div>
  );
}

function Shortcut({ k, label }: { k: string; label: string }): JSX.Element {
  return (
    <>
      <kbd className="justify-self-start rounded bg-ink-800 px-2 py-0.5 text-accent">{k}</kbd>
      <span className="text-ink-200">{label}</span>
    </>
  );
}
