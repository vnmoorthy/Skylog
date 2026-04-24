/**
 * SKYLOG — floating top bar.
 *
 * Sits over the LiveMap. Hosts the brand, layer toggles, search input
 * slot, and drawer entry points (home, timeline, settings, help).
 */

import { useSky } from "../state/store";

interface TopBarProps {
  showSatellites: boolean;
  onToggleSatellites: () => void;
  onOpenHomeSetup: () => void;
  onOpenTimeline: () => void;
  onOpenHelp: () => void;
  children?: React.ReactNode;
}

export function TopBar({
  showSatellites,
  onToggleSatellites,
  onOpenHomeSetup,
  onOpenTimeline,
  onOpenHelp,
  children,
}: TopBarProps): JSX.Element {
  const home = useSky((s) => s.home);
  const passCount = useSky((s) => Object.keys(s.passes).length);
  const setSettingsOpen = useSky((s) => s.setSettingsOpen);

  return (
    <header className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded bg-ink-900/85 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-accent" />
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-100">
            skylog
          </span>
        </div>
        <span className="hidden font-mono text-[9px] uppercase tracking-wider text-ink-500 sm:inline">
          live plane &amp; satellite tracker
        </span>
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        {children}
        <nav className="flex items-center gap-1 rounded bg-ink-900/85 px-1.5 py-1 backdrop-blur">
          <Btn onClick={onToggleSatellites} active={showSatellites}>
            satellites
          </Btn>
          <Btn onClick={onOpenHomeSetup}>
            {home ? "home" : "set home"}
          </Btn>
          <Btn onClick={onOpenTimeline} disabled={!home}>
            timeline{passCount > 0 ? ` · ${passCount}` : ""}
          </Btn>
          <Btn onClick={() => setSettingsOpen(true)}>settings</Btn>
          <Btn onClick={onOpenHelp}>?</Btn>
        </nav>
      </div>
    </header>
  );
}

function Btn({
  onClick,
  children,
  active,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const base =
    "rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition";
  const cls = disabled
    ? `${base} text-ink-600 cursor-not-allowed`
    : active
    ? `${base} bg-accent/20 text-accent`
    : `${base} text-ink-300 hover:text-ink-100 hover:bg-ink-800/80`;
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
