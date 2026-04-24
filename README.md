# SKYLOG

A real-time map of every plane flying near you, plus the ISS and other named satellites. Click a plane for its registration, type, altitude, and heading. Set a home location and Skylog will also log every aircraft that passes within your radius, estimate the ground-level loudness, and let you scrub through the last 24 hours on a timeline. All data lives in your browser — no account, no server, no third-party tracker.

![Skylog screenshot](./docs/screenshot.png)

## Why

Flight trackers are optimised for airline route-planners, not curious humans. They load slowly, bury data behind paywalls, and ask you to guess which moving dot woke you up at 3 AM. Skylog inverts that: open the app and within three seconds you are staring at a dark map with every ADS-B-equipped aircraft within the viewport rendered as a rotated arrow, coloured by altitude, moving smoothly. That is the whole product. Everything else — pass logs, loudness, satellites — is a layer on top.

## Features

- **Live map as the first screen.** No onboarding gate. Open the page, the map centers on your location if you grant geolocation, otherwise a busy default (NYC), and the airplanes.live global feed populates the viewport in under five seconds.
- **Smooth motion between polls.** The feed returns a snapshot every ten seconds; Skylog dead-reckons each aircraft's position at 10 Hz using its broadcast velocity and track, so planes move smoothly instead of teleporting.
- **Click-to-identify.** Tap any aircraft for airline, callsign, aircraft type, registration, altitude, speed, heading, squawk, and data source. Aircraft metadata is resolved client-side against a bundled compact JSON built from the OpenSky aircraft database.
- **Nearest-to-home indicator.** When you have a home set, the bottom-left corner always shows the three nearest aircraft ranked by distance — click to jump to their detail card.
- **Aircraft list (shortcut `l`).** Sortable, searchable list of every plane in view. Filter by callsign, ICAO24, or country. Sort by altitude or distance from home.
- **Satellites (shortcut `s`).** ISS and the rest of the Celestrak "stations" group, propagated in-browser with [satellite.js](https://github.com/shashwatak/satellite-js)'s SGP4 port. Click a satellite for a dashed ground-track preview showing its last 90 minutes and next 90 minutes.
- **Pass logger + loudness model.** If you set a home, a Web Worker polls OpenSky for your bounding box and aggregates each aircraft into a "pass" with closest approach time, ground distance, altitude, and an estimated dB(A) SPL using the inverse-square law + ISO 9613-2:1996 §7.2 atmospheric absorption. Browse the last 72 hours on a zoomable timeline.

## Keyboard shortcuts

| key | action |
| --- | --- |
| `s` | toggle satellites |
| `l` | toggle aircraft list |
| `h` | open home setup |
| `t` | open timeline (requires home) |
| `?` | help |
| `esc` | close the active panel |

## How the loudness model works

For each aircraft sample we receive, we estimate the A-weighted sound pressure level (SPL) at the user's home using two physical effects in series: geometric spreading (the inverse-square law) and atmospheric absorption.

### The inverse-square law

A point source radiating power **W** into a free field spreads that power over an expanding spherical wavefront of area **4πr²**. Intensity is power per area, so intensity falls as **1/r²**:

$$
I(r) = \frac{W}{4\pi r^{2}}
$$

SPL is logarithmic against a reference. Because intensity is proportional to the square of pressure, doubling distance halves pressure and SPL drops by exactly **20·log₁₀(2) ≈ 6.02 dB**:

$$
L(r) = L_{\mathrm{ref}} - 20\,\log_{10}\!\left(\frac{r}{r_{\mathrm{ref}}}\right)
$$

We take **r_ref = 1 m** and calibrate source levels **L_ref** per aircraft category against published certification data.

### Atmospheric absorption

Molecular relaxation of nitrogen and oxygen, viscosity, and thermal conduction remove acoustic energy as the wave travels. ISO 9613-2:1996 §7.2 defines a frequency-, temperature-, and humidity-dependent attenuation coefficient **α** in dB/m. For broadband aircraft noise centred around 500–1000 Hz at 10 °C / 60 % RH / 101.325 kPa, a representative single-number collapse is approximately **0.005 dB/m** (= 5 dB/km). We apply this linearly.

### Combined equation

$$
L_{\mathrm{observed}} \;=\; L_{\mathrm{source}} \;-\; 20\,\log_{10}\!\left(\frac{r_{\mathrm{slant}}}{1\,\mathrm{m}}\right) \;-\; \alpha\, r_{\mathrm{slant}}
$$

Where **r_slant = √(ground_distance² + altitude²)**. A pass's reported dB is the *minimum* r_slant over the pass — the point of closest approach.

### Constants

| Symbol | Meaning | Value | Units | Source |
| --- | --- | --- | --- | --- |
| L_src HEAVY (747) | Source level at 1 m | 140 | dB(A) | FAA AC 36-1H flyover data |
| L_src LARGE (737/A320) | Source level at 1 m | 135 | dB(A) | FAA AC 36-1H |
| L_src SMALL (regional) | Source level at 1 m | 125 | dB(A) | FAA AC 36-1H |
| L_src LIGHT (Cessna) | Source level at 1 m | 105 | dB(A) | FAA AC 36-1H |
| L_src ROTORCRAFT | Source level at 1 m | 130 | dB(A) | Bell 212 flyover back-calculation |
| α | Atmospheric absorption | 0.005 | dB/m | ISO 9613-2:1996 Table B.1 |
| r_ref | Reference distance | 1 | m | convention |
| Earth radius | WGS-84 mean | 6,371,008.7714 | m | IUGG 1980 |

Full constants table with inline citations lives in [`src/lib/acoustics.ts`](./src/lib/acoustics.ts).

### Worked example

A Boeing 737 (category `LARGE`, L_src = 135 dB) directly overhead at 3,000 ft:

- altitude = 914 m → r_slant = 914 m
- geometric loss: `20·log₁₀(914) ≈ 59.2 dB`
- atmospheric loss: `0.005 × 914 ≈ 4.6 dB`
- **L_observed ≈ 135 − 59.2 − 4.6 = 71.2 dB** — roughly the volume of a vacuum cleaner in the next room.

A 747 at the same geometry lands at ~76 dB. A Cessna 172 at 1,500 ft lands at ~46 dB — barely audible over suburban ambient. Those numbers match the informal "sounded like a mid-size jet at a few thousand feet" estimates most people make.

### What this model deliberately does not do

- No ground reflection (can add up to 3 dB at a standing listener).
- No directivity. Modern turbofans radiate more forward than aft during climb; we treat every source as omnidirectional.
- No thrust modulation. Climb is louder than cruise; we use one L_src per category.
- No per-frequency absorption. ISO 9613-2 varies α from 0.1 dB/km at 63 Hz to 80+ dB/km at 8 kHz.
- No weather integration. We assume still air at 10 °C / 60 % RH.

The model is for distinguishing a 747 from a Cessna at a glance, not for replacing a certified noise measurement.

## Architecture

```
 ┌──────────────┐  fetch OpenSky every 10s based on map bbox
 │   browser    │ ──────────────────────────────────▶ OpenSky REST
 │ (main thread)│                                          │
 └──────┬───────┘                                          │
        │  render: MapLibre GL + pooled DOM markers        │
        │  animate: rAF @ 10 Hz dead-reckoning             │
        │                                                  │
        │  if home is set:                                 │
        │     new Worker(skyPoller.worker.ts)              │
        │         │                                        │
        │         │ fetch own bbox + acoustics calcs       │
        │         │ Dexie bulk put                         │
        │         ▼                                        │
        │     IndexedDB (passes, cached metadata)          │
        │                                                  │
        │  TLE propagation:                                │
        │     satellite.js SGP4 in main thread             │
        │     cache Celestrak TLEs in localStorage (6h)    │
        ▼
   Zustand store · React rendering
```

The poller worker and the live-map poller are independent. The worker owns the ground truth for historical passes; the live map is a live-view with no persistence.

## Run locally

```bash
pnpm install       # ~10s
pnpm build:data    # optional; enriches detail panel with aircraft type / operator
pnpm dev           # http://localhost:5173
```

Production build:

```bash
pnpm build
pnpm preview
```

Tests:

```bash
pnpm test
```

There are 83 unit tests across `geo`, `acoustics`, `opensky`, `callsign`, `units`, and `deadReckon`. Coverage focuses on the physics and decoding layers.

## Deployment

The `main` branch deploys to GitHub Pages automatically on push. See `.github/workflows/deploy.yml`. The Vite build sets `base` to `/Skylog/` only for production, so local dev continues to work from `/`.

## Limitations

- **ADS-B coverage isn't perfect.** Most commercial traffic transmits, but some general-aviation aircraft and all military traffic don't. OpenSky's coverage has gaps over ocean and remote regions.
- **OpenSky anonymous limits.** 400 credits/day. Skylog skips polls when the bbox would cost ≥3 credits (roughly, when you're zoomed out past country scale).
- **72-hour rolling buffer.** Older passes drop. The 50 MB IndexedDB ceiling triggers a 20% prune when crossed.
- **Single location.** v0.2 tracks one home at a time.
- **Simplified loudness.** See "what this model deliberately does not do" above.

## Stack

Vite · React 18 · TypeScript strict · Tailwind · Zustand · Dexie · MapLibre GL · D3 scales · satellite.js · Web Worker for pass logging.

## License

MIT. See [`LICENSE`](./LICENSE).

## Acknowledgements

- [airplanes.live](https://airplanes.live/) — the CORS-friendly live ADS-B feed.
- [OpenSky Network](https://opensky-network.org/) — historical pass-logger feed and the aircraft metadata DB.
- [Celestrak](https://celestrak.org/) — satellite TLEs.
- [CARTO](https://carto.com/) — dark basemap tiles.
- [MapLibre](https://maplibre.org/) — open map renderer.
- [satellite.js](https://github.com/shashwatak/satellite-js) — SGP4 port.
- [OurAirports](https://ourairports.com/) — airport metadata (public domain).
- [Dexie](https://dexie.org/) — IndexedDB wrapper.
