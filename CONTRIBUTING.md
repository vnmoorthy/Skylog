# Contributing to Skylog

Thanks for considering a contribution! Skylog is a small, focused, single-page open-source project — perfect for a first PR.

## Quick start

```bash
git clone https://github.com/YOUR-USERNAME/Skylog.git
cd Skylog
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # run the test suite
pnpm typecheck    # strict TypeScript check
```

## Where to start

- Browse [issues labelled `good first issue`](https://github.com/vnmoorthy/Skylog/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — small, well-scoped tasks.
- Browse [issues labelled `help wanted`](https://github.com/vnmoorthy/Skylog/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) — bigger items where we'd love input.
- Have a feature idea? Open a [Discussion](https://github.com/vnmoorthy/Skylog/discussions) before writing code so we can align on direction.
- Found a bug? Open an [issue](https://github.com/vnmoorthy/Skylog/issues/new/choose) with a reproduction.

## Code style

- TypeScript **strict mode**. No `any`. No `@ts-ignore`. If a type is hard, extract it into `lib/`.
- React functional components only.
- Tailwind for styling — keep classes inline, no CSS modules.
- Files in `src/lib/` should be **pure** when possible and have unit tests.
- Comments should explain **why**, not what. The reader can read the code; help them understand the reasoning.
- Run `pnpm typecheck && pnpm test` before pushing.

## Architecture cheat sheet

```
src/
├── App.tsx                    # root layout, wires everything
├── components/                # React components
│   ├── LiveMap.tsx            # full-screen MapLibre + plane markers (hero)
│   ├── FlightCard.tsx         # click-a-plane detail card
│   ├── MemoryDrawer.tsx       # left drawer — sightings memory
│   ├── DigestCard.tsx         # top-right always-on digest
│   ├── TrackedFlightCard.tsx  # bottom-center tracked-flight card
│   ├── TrackFlightPrompt.tsx  # paste-a-callsign modal
│   ├── AircraftListPanel.tsx  # right-side searchable list
│   ├── HomeSetup.tsx          # home picker modal
│   └── ...
├── lib/
│   ├── livePoller.ts          # viewport-driven airplanes.live poller
│   ├── flightTracker.ts       # per-callsign poller (tracked flights)
│   ├── sightings.ts           # gbrain-style aircraft memory
│   ├── deadReckon.ts          # smooth motion between polls
│   ├── satellites.ts          # satellite.js + Celestrak TLEs
│   ├── opensky.ts             # OpenSky decoder + types
│   ├── geo.ts, acoustics.ts, units.ts, callsign.ts, db.ts
│   └── *.test.ts              # vitest unit tests
├── state/store.ts             # zustand global store
├── workers/skyPoller.worker.ts # home-radius pass logger
└── styles/globals.css         # tailwind + MapLibre overrides
```

## PR checklist

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` passing
- [ ] `pnpm build` succeeds
- [ ] If you added a lib function, you added unit tests
- [ ] If you added a UI feature, the README's feature table is updated
- [ ] Commits are squashed or logically grouped — no `wip`, `fix typo` chains
- [ ] Commit message explains the **why**, not just the what

## Code of conduct

Be kind. Be patient. Assume the best of others. Skylog exists to be enjoyed.
