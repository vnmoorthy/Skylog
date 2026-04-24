# Skylog pre-ship review

Applied before v0.3. Roughly structured as gstack's CEO → Design → Eng →
QA → Ship review discipline, condensed to the decisions that actually
change what ships.

---

## CEO review — who is Skylog for?

**Core customer:** a curious person — not an AvGeek, not a pilot — who
lives near an airport or flight corridor and wonders, during any given
hour, what's flying over. They're the person who hears a loud plane at
3 AM and wants to know who to complain to; or the parent whose kid
shouts "plane!" and wants a one-second "what was that?" answer; or the
person tracking a friend's incoming flight.

**Not the customer:** the professional route-planner. Flightradar24
and ADS-B Exchange already own this market — they will always have
more data than us. We don't compete there.

**One-line value prop:** "The flight tracker that remembers every
plane it's ever seen over your house."

Nobody else does this. Every flight tracker is amnesic. Persistent
memory + correlation is the gbrain-shaped insight that makes Skylog
stand out. It is the feature we bet v0.3 on.

**What to cut:** nothing in v0.2 gets cut — but we stop spending
design attention on the historical passes timeline. It's a power-user
feature that should live where power users look (keyboard `t`),
not on the first screen.

---

## Design review — first 5 seconds

What the user sees on load should, in order:

1. A dark, premium-feeling map — already there via CARTO dark_all.
2. Aircraft visible within 3 s — already there via airplanes.live.
3. Something that hints this isn't just another tracker.

Item 3 is missing. Today the app boots into "here's a map with planes".
That is good, but it is not memorable. Fixes:

- **WelcomeHint** must explicitly tease the memory feature on first
  boot: "Skylog remembers every plane it sees. Come back tomorrow —
  that 737 will be waiting for you."
- The TopBar brand mark should include a subtle live heartbeat pulse
  tied to the poll cadence so the "live" promise is felt, not said.
- When a user hovers a plane we've seen before, the marker should
  sparkle. Small, but this is the moment that earns the memory
  feature's place.
- OverheadIndicator should not say "nothing within 75 km". It should
  say "no planes right now — Skylog is watching" with a subtle pulse.

---

## Eng review — quality bar

Current state is solid: 83 unit tests, TS strict, no `any`, 124 KB
gzip main + MapLibre isolated. Remaining items:

- **Race conditions on poll boundaries.** When a user clicks a plane
  that then leaves the viewport between polls, FlightCard currently
  shows stale state forever. Fix: FlightCard listens for
  "disappeared" events and flags "last seen Xm ago".
- **Memory leaks from markers.** `markersRef` removes stale DOM nodes
  but if a user rapidly pans, MapLibre's underlying WebGL reuses
  resources badly. Acceptable for v0.3 — revisit if profiling shows
  growth.
- **Dexie version upgrades.** New stores require schema version bump;
  I will bump to v2 for the sightings store and write a no-op
  upgrade fn.
- **Privacy audit.** The app makes HTTPS calls to: airplanes.live,
  celestrak.org, basemaps.cartocdn.com, tile.openstreetmap.org (no —
  we dropped this in v0.2), the user's own geolocation API. All of
  those are documented; no third-party tracker; no Google Analytics;
  no telemetry.
- **Error boundaries.** None today. React's uncaught render error
  shows a blank page. Add a minimal ErrorBoundary wrapping App so a
  component crash surfaces a "something broke — reload" card.

---

## QA — real-world failure modes

What breaks in production that my tests don't cover:

- Airplanes.live is down → status badge says "Error"; the app should
  fall back to cached results if present, with a "last updated Xm ago"
  banner.
- Celestrak TLEs are down → satellites toggle shows "couldn't load
  satellites"; don't silently fail.
- User has VPN that blocks airplanes.live → same failure mode as above.
- User is on 3G phone → MapLibre takes 5+ seconds to render. Add a
  shimmer under the brand mark while tiles are loading.
- User zooms out past country scale → status says "zoom in to load
  aircraft". Add a gentle zoom-in affordance (a button or just an
  arrow).
- User locks screen mid-session → setInterval on 150 ms repaint poll
  keeps running in background. Acceptable for v0.3 (stops after 4 s)
  but satellite.js 1 Hz tick should pause on `document.visibilitychange`.
- Narrow-screen landscape (iPhone SE rotated, iPad split-view): today
  the right-side panels overlap the map. v0.3 must fix this.
- User disables geolocation silently → map stays on NYC. Acceptable.

---

## Ship checklist

- [x] Typecheck, test, build clean
- [x] No PII in logs
- [x] No third-party telemetry
- [x] 404 fallback not required (single-route SPA with hash-free nav)
- [ ] Meta tags, OG image, favicon — v0.3 will add
- [ ] Mobile layout sanity pass — v0.3 will add
- [ ] Error boundary — v0.3 will add
- [ ] Graceful live-feed-down banner — v0.3 will add

v0.3 ships the above, plus the aircraft memory killer feature.
