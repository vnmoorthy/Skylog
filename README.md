# SKYLOG

A location-anchored timeline of every plane that flies over your house, with an on-device loudness model. Set your location, and SKYLOG quietly logs every aircraft that passes within your radius, estimates how loud it was on the ground, and renders the last 24 hours as a horizontal timeline. Scroll back through last night and find the 3 AM offender. All data lives in your browser — no account, no server, no third-party tracker.


## Why this exists

Flight trackers are map-first. When you hear a loud plane overhead, you're supposed to open Flightradar24 and guess which moving dot just passed you — except by the time the page loads, it's gone. Historical playback is paywalled or clumsy on mobile. Noise-complaint portals are disconnected from real ADS-B data. SKYLOG inverts the camera: your location is the origin, the axis is time, and the aircraft is the value on that axis.

## How the loudness model works

For each aircraft sample we receive, we estimate the A-weighted sound pressure level (SPL) at the user's location using two physical effects in series: geometric spreading (inverse-square law) and atmospheric absorption.

### The inverse-square law

A point source radiating power **W** into a free field spreads that power over an expanding spherical wavefront of area **4πr²**. Intensity is power-per-area, so intensity falls as **1/r²**:

$$
I(r) = \frac{W}{4\pi r^{2}}
$$

Sound pressure level is defined logarithmically against a reference. Because intensity is proportional to the square of pressure, doubling distance halves pressure and SPL drops by exactly **20·log₁₀(2) ≈ 6.02 dB**:

$$
L(r) = L_{\mathrm{ref}} - 20\,\log_{10}\!\left(\frac{r}{r_{\mathrm{ref}}}\right)
$$

We take **r_ref = 1 m** and calibrate source levels **L_ref** per aircraft category against published certification and flyover data (see the constants table below).

### Atmospheric absorption

Air is not a perfect propagation medium. Molecular relaxation of nitrogen and oxygen, viscosity, and thermal conduction remove acoustic energy from the wave as it travels. ISO 9613-2:1996 §7.2 defines a frequency-, temperature-, and humidity-dependent attenuation coefficient **α** in dB/m. For broadband aircraft noise centered around 500–1000 Hz, at 10 °C / 60 % RH / 101.325 kPa, the collapsed single-number representative is approximately **0.005 dB/m** (= 5 dB/km). We apply this as a linear term.

### Combined equation

$$
L_{\mathrm{observed}} \;=\; L_{\mathrm{source}} \;-\; 20\,\log_{10}\!\left(\frac{r_{\mathrm{slant}}}{1\,\mathrm{m}}\right) \;-\; \alpha\, r_{\mathrm{slant}}
$$

Where **r_slant = √(groundDistance² + altitude²)**. The pass's reported dB is the *minimum* r_slant over the pass — the point of closest approach.

### Constants

| Symbol | Meaning | Value | Units | Source |
| --- | --- | --- | --- | --- |
| L_src (Heavy, e.g. 747) | Source level at 1 m | 140 | dB(A) | Calibrated against FAA AC 36-1H flyover data |
| L_src (Large, e.g. 737/A320) | Source level at 1 m | 135 | dB(A) | Calibrated against FAA AC 36-1H |
| L_src (Small, regional jets / turboprops) | Source level at 1 m | 125 | dB(A) | Calibrated against FAA AC 36-1H |
| L_src (Light, Cessna-class) | Source level at 1 m | 105 | dB(A) | Calibrated against FAA AC 36-1H |
| L_src (Rotorcraft) | Source level at 1 m | 130 | dB(A) | Bell 212 at 500 ft → ~82 dB back-calculated |
| α | Atmospheric absorption | 0.005 | dB/m | ISO 9613-2:1996, Table B.1 (mid-frequency, 10 °C / 60 % RH) |
| r_ref | Reference distance | 1 | m | Convention |
| Earth radius (R₁) | WGS-84 mean radius | 6,371,008.7714 | m | IUGG 1980 |

Full constants table is in [`src/lib/acoustics.ts`](./src/lib/acoustics.ts) with inline citations.

### Worked example

A Boeing 737 (category `LARGE`, L_src = 135 dB) at 3,000 ft directly overhead:

- altitude = 914 m → r_slant = 914 m
- geometric loss: `20·log₁₀(914) ≈ 59.2 dB`
- atmospheric loss: `0.005 × 914 ≈ 4.6 dB`
- **L_observed ≈ 135 − 59.2 − 4.6 = 71.2 dB**

That's roughly the volume of a vacuum cleaner running in the next room. A 747 (HEAVY, L_src = 140) at the same geometry lands at ~76 dB. A Cessna 172 (LIGHT, L_src = 105) at 1,500 ft lands at ~46 dB — barely audible over suburban ambient. Those numbers match well with the informal "that sounded like a mid-sized jet at a few thousand feet" estimation most people make.

### What this model deliberately does not do

- No ground reflection. Real aircraft noise bounces off the ground and sometimes **adds** up to 3 dB at a standing listener.
- No directivity. Modern turbofans radiate more forward than aft during climb; we treat every source as omnidirectional.
- No thrust modulation. A plane in climb is louder than the same plane in cruise. We use a single L_src per category.
- No per-frequency absorption. ISO 9613-2 varies α with frequency from 0.1 dB/km at 63 Hz to 80+ dB/km at 8 kHz.
- No weather integration. We assume still air at 10 °C / 60 % RH.

The goal is to distinguish a 747 from a Cessna at a glance, not to replace a certified noise measurement.

## Architecture

```
 ┌──────────────┐   poll every 10 s    ┌─────────────┐
 │   browser    │ ───────────────────▶ │  OpenSky    │
 │ (main thread)│                       │  REST API   │
 └──────────────┘                       └─────────────┘
       ▲  ▲                                    │
       │  │  STATUS / PASS / LIVE_TICK         │ states JSON
       │  │                                    ▼
       │  └──────────────  ┌──────────────────────────┐
       │                   │  skyPoller.worker.ts     │
       │                   │  - loudness calc         │
       │                   │  - closest-approach      │
       │                   │  - pass aggregation      │
       │                   └────────┬─────────────────┘
       │                            │ Dexie bulk put
       │                            ▼
       │                   ┌──────────────────────────┐
       │                   │  IndexedDB (Dexie)       │
       │                   │  - passes (72h rolling)  │
       │                   │  - aircraft lookup cache │
       │                   │  - airport lookup cache  │
       │                   └──────────────────────────┘
       │
 ┌─────┴────────┐
 │  Zustand     │   hydrates on boot from Dexie
 │  store       │
 └─────┬────────┘
       │
 ┌─────▼────────┐   D3 scales + SVG drawing
 │  Timeline    │
 │  LivePanel   │   MapLibre GL (OSM demotiles, no token)
 │  DetailPanel │
 └──────────────┘
```

The poller is the only component that ever touches the network. The UI reads from the store, which is a cache of what's in IndexedDB.

## Run locally

```bash
pnpm install        # ~10 s
pnpm build:data     # downloads OpenSky aircraft CSV + OurAirports CSV,
                    # produces compact gzipped JSON under public/data/
pnpm dev            # http://localhost:5173
```

The data build step is optional — the app runs fine without it, just without aircraft-type/operator resolution in the detail panel.

Production build:

```bash
pnpm build          # tsc -b && vite build
pnpm preview        # serve the built bundle
```

Tests:

```bash
pnpm test           # 75 unit tests across geo/acoustics/opensky/callsign/units
```

## Limitations

- **ADS-B coverage isn't perfect.** Most commercial traffic transmits, but some general-aviation aircraft and all military traffic don't. The OpenSky network also has coverage gaps over ocean and remote areas.
- **OpenSky anonymous rate limits.** Anonymous callers get ~400 credits/day. SKYLOG uses a single bounding-box query per 10 seconds. For a 25 km radius at typical latitudes that's 1 credit/call, which gives ~66 minutes of continuous polling on the daily budget. The worker reports a `rate_limited` status and waits for the daily reset when it hits the cap. Signed-in OpenSky users can pass credentials; v0.1 doesn't expose that.
- **72-hour rolling buffer.** Older passes are dropped. The 50 MB IndexedDB ceiling triggers a 20 % prune when crossed.
- **Simplified loudness.** See "What this model deliberately does not do" above. Useful for relative comparisons, not certifiable measurements.
- **Single location.** v0.1 tracks one origin only. v0.2 is where multi-location + named presets live.
- **Desktop-first.** Mobile layout is usable but not optimized — the timeline strip is the hero and wants horizontal space.

## License

MIT. See [`LICENSE`](./LICENSE).

## Acknowledgements

- [OpenSky Network](https://opensky-network.org/) — state vectors and the aircraft metadata database. Please consider donating or contributing a feeder.
- [OurAirports](https://ourairports.com/) — airport metadata (public domain).
- [MapLibre](https://maplibre.org/) — open-source map renderer.
- [Dexie](https://dexie.org/) — a pleasant wrapper around IndexedDB.
