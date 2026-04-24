/**
 * SKYLOG — floating top bar.
 *
 * Sits over LiveMap. Brand mark on the left, control cluster on the
 * right. Keyboard shortcuts shown in tooltips so the app teaches itself
 * over time.
 */

import { useSky } from "../state/store";
import { RegionPicker } from "./RegionPicker";

interface TopBarProps {
  showSatellites: boolean;
  onToggleSatellites: () => void;
  onOpenHomeSetup: () => void;
  onOpenTimeline: () => void;
  onOpenList: () => void;
  listOpen: boolean;
  onOpenHelp: () => void;
  onOpenMemory: () => void;
  memoryOpen: boolean;
  onPickRegion: (center: [number, number], zoom: number) => void;
}

export function TopBar({
  showSatellites,
  onToggleSatellites,
  onOpenHomeSetup,
  onOpenTimeline,
  onOpenList,
  listOpen,
  onOpenHelp,
  onOpenMemory,
  memoryOpen,
  onPickRegion,
}: TopBarProps): JSX.Element {
  const home = useSky((s) => s.home);
  const passCount = useSky((s) => Object.keys(s.passes).length);
  const setSettingsOpen = useSky((s) => s.setSettingsOpen);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between px-4 py-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded bg-ink-900/85 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-accent animate-pulse" />
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-100">
            skylog
          </span>
        </div>
        <span className="hidden sm:inline font-mono text-[9px] uppercase tracking-wider text-ink-500">
          live plane &amp; satellite tracker
        </span>
      </div>

      <nav className="pointer-events-auto flex max-w-[85vw] items-center gap-1 overflow-x-auto rounded bg-ink-900/85 px-1.5 py-1.5 backdrop-blur">
        <RegionPicker onPick={onPickRegion} />
        <Btn onClick={onOpenMemory} active={memoryOpen} shortcut="M">
          memory
        </Btn>
        <Btn onClick={onToggleSatellites} active={showSatellites} shortcut="S">
          satellites
        </Btn>
        <Btn onClick={onOpenList} active={listOpen} shortcut="L">
          list
        </Btn>
        <Btn onClick={onOpenHomeSetup} shortcut="H">
          {home ? "change home" : "set home"}
        </Btn>
        <Btn onClick={onOpenTimeline} disabled={!home} shortcut="T">
          timeline{passCount > 0 ? ` (${passCount})` : ""}
        </Btn>
        <Btn onClick={onOpenHelp} shortcut="?">help</Btn>
        <Btn onClick={() => setSettingsOpen(true)}>settings</Btn>
      </nav>
    </header>
  );
}

function Btn({
  onClick,
  children,
  active,
  disabled,
  shortcut,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
}): JSX.Element {
  const base =
    "rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition";
  const cls = disabled
    ? `${base} text-ink-600 cursor-not-allowed`
    : active
    ? `${base} bg-accent/20 text-accent`
    : `${base} text-ink-300 hover:text-ink-100 hover:bg-ink-800/80`;
  const title = shortcut ? `shortcut: ${shortcut}` : undefined;
  return (
    <button onClick={onClick} disabled={disabled} className={cls} title={title}>
      {children}
    </button>
  );
}
