# CLAUDE.md — Skylog repo guidance

This repo includes [gstack](https://github.com/garrytan/gstack) at `.claude/skills/gstack/`. It provides 30+ slash commands for AI-assisted development.

## Available gstack skills

When working in this repo via Claude Code, use these skills:

**Planning** — `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/plan-devex-review`, `/autoplan`

**Build** — `/design-consultation`, `/design-shotgun`, `/design-html`

**Review** — `/review`, `/cso`, `/codex`, `/investigate`, `/design-review`, `/devex-review`, `/qa`, `/qa-only`

**Ship** — `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/document-release`

**Reflect** — `/retro`, `/learn`

**Browser** — `/browse`, `/connect-chrome`, `/setup-browser-cookies`

**Safety** — `/careful`, `/freeze`, `/guard`, `/unfreeze`

**Setup** — `/setup-deploy`, `/setup-gbrain`, `/gstack-upgrade`

## Skylog-specific notes

- Stack: Vite · React 18 · TypeScript strict · Tailwind · Zustand · Dexie · MapLibre · satellite.js
- Live data source: airplanes.live (CORS-safe community ADS-B feed). Do NOT switch to OpenSky direct — it has no CORS headers from GitHub Pages origins and will silently fail in production.
- Default basemap: CartoDB `dark_all` raster tiles. Keep STYLE_DARK minimal — over-specified MapLibre styles cause silent parse failures and a black canvas in production.
- IndexedDB schema lives in `src/lib/db.ts`. Bump version + add upgrade fn for any new column.
- Strict mode: no `any`, no `@ts-ignore`. If a type is hard, extract it.
- Tests: `pnpm test` (vitest, jsdom). Pure-lib code in `src/lib/` should always have tests.
- Build: `pnpm typecheck && pnpm test && pnpm build` should always pass before committing.

## Full gstack docs

See `.claude/skills/gstack/README.md` and `.claude/skills/gstack/SKILL.md` for the full toolkit. Each command's prompt lives in its own folder, e.g. `.claude/skills/gstack/cso/SKILL.md` for the security-officer skill.
