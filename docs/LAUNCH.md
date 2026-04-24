# 🚀 Launch playbook

The single highest-leverage thing you can do for stars is a coordinated launch — Show HN + 3–4 Reddit posts + a Twitter thread, all on the same day, ideally **Tuesday or Wednesday between 8–10 AM Pacific** (when HN/Reddit US-tech traffic peaks). Below are launch-ready drafts. Don't blast all of them at once; sequence them.

## 0. Pre-launch checklist (do these the day before)

- [ ] Replace `docs/hero.png` in the repo with a real screenshot (use `?demo=london` or pan to a busy city).
- [ ] Record a 10-15s screen capture, convert to GIF (`ffmpeg -i in.mp4 -vf "fps=12,scale=900:-1:flags=lanczos" hero.gif`), commit as `docs/demo.gif`, swap into README.
- [ ] Verify the live demo loads cleanly in incognito on mobile + desktop.
- [ ] Open three "good first issue" tickets so contributors arriving via the launch have somewhere to land.
- [ ] Re-check the GitHub repo description and topic tags (see SETUP_TAGS.md).
- [ ] Watch the repo's traffic graph the morning of launch — be ready to respond to comments within 30 min.

---

## 1. Show HN

**Title** (under 80 chars):

> Show HN: Skylog – a flight tracker that remembers every plane over your house

**URL field:**

> https://vnmoorthy.github.io/Skylog/

**Body** (post as a comment immediately after submitting):

> Hi HN — I built Skylog because every flight tracker forgets every plane the second it leaves the screen. There's no concept of "your sky."
>
> Skylog is a single-page web app (no backend, no account, MIT-licensed) that:
>
> - shows every ADS-B-equipped aircraft worldwide on a dark MapLibre canvas, polled from airplanes.live every 10 s with smooth dead-reckoning between polls
> - **persists every aircraft it sees to your IndexedDB**, with first/last seen, all callsigns used, altitude min/max, and a rolling timestamp log
> - runs a small clustering pass over those timestamps to surface "regular visitors" — `UAL841 — Tuesdays around 07:00, ×7 sightings`
> - lets you paste a callsign and pin a specific flight globally with a live ETA-to-home and a browser notification at 5 km out
> - includes ISS + Celestrak satellite overlay (satellite.js SGP4 client-side)
> - includes an on-device acoustic model (inverse-square + ISO 9613-2 atmospheric absorption) that estimates ground-level dB(A) per pass — calibrated against published FAA flyover data
>
> Repo: https://github.com/vnmoorthy/Skylog
>
> Stack: Vite + React 18 + TypeScript strict + Tailwind + Zustand + Dexie + MapLibre GL + satellite.js. 101 unit tests. Main bundle 131 KB gzipped, MapLibre isolated to a separate chunk.
>
> Happy to talk about the dead-reckoning math, the IndexedDB schema, the SGP4 propagation, the acoustic model calibration, or why I think persistent memory is the missing piece in every flight tracker.

**Comment-reply tips:** be technical, be honest about limitations (community ADS-B feed has gaps in S. America / Africa, the loudness model is rough, etc.), and respond to every top-level comment within an hour during launch day.

---

## 2. Reddit posts

Sequence them: post to /r/aviation first (the friendliest), then /r/selfhosted (loves privacy angle), then /r/webdev (loves the stack), then /r/opensource. Spread them across 24h, not all at once.

### /r/aviation

**Title:**

> I built a free, open-source flight tracker that remembers every plane over your house

**Body:**

> Hey r/aviation. I got tired of opening Flightradar24 to identify the same 737 that wakes me up every Tuesday and seeing it forget the plane the moment I close the tab. So I built Skylog: an open-source web flight tracker that *remembers* every aircraft it has ever seen over your home.
>
> After a few days of leaving a tab open it'll tell you things like *"UAL841 — Tuesdays around 07:00, ×7 sightings, max altitude 31,000 ft."* That's data Flightradar24 will never show you because it doesn't know what your sky looks like.
>
> Other features: live worldwide map, click-for-details, paste a callsign to track a specific flight with browser notification at 5 km out, ISS / satellite overlay, on-device dB estimate.
>
> Free, no account, MIT-licensed, runs in your browser only. Coverage uses airplanes.live (community ADS-B network).
>
> Live: https://vnmoorthy.github.io/Skylog/
> Code: https://github.com/vnmoorthy/Skylog
>
> Feedback / bug reports / PRs welcome.

### /r/selfhosted

**Title:**

> [release] Skylog – self-hostable, privacy-first flight tracker (no backend, no account, no tracker)

**Body:**

> Hey r/selfhosted. Wanted to share Skylog: a single-page flight tracker designed for self-hosting.
>
> No backend. No database. No account. No analytics. No third-party scripts. Everything runs client-side in your browser. Your sightings live in IndexedDB on your device.
>
> Fork the repo → enable GitHub Pages → it's live at `https://YOU.github.io/Skylog/` in 60 seconds. Zero infra.
>
> Features:
> - Live worldwide aircraft map (airplanes.live community feed, CORS-safe, no key)
> - Persistent per-aircraft memory + pattern detection ("regular visitors over your house")
> - Track a specific flight by callsign + browser-native notification at 5 km from home
> - ISS / Celestrak satellite overlay
> - Bundled OpenSky aircraft type DB for instant aircraft identity on click
> - On-device acoustic model (inverse-square + ISO 9613-2) for noise complaint evidence
>
> Stack: React + TypeScript + Vite + MapLibre + Dexie. 101 unit tests. Main bundle 131 KB gzip. MIT.
>
> Live: https://vnmoorthy.github.io/Skylog/
> Code: https://github.com/vnmoorthy/Skylog

### /r/webdev

**Title:**

> Show /r/webdev: I shipped a real-time flight tracker as a single SPA — 131 KB main bundle, no backend, runs anywhere

**Body:**

> A walk through the technical interesting bits of Skylog:
>
> 1. **Live ADS-B map** — pulls airplanes.live every 10 s within the current viewport bbox. Smooth motion between polls via requestAnimationFrame dead-reckoning using each aircraft's broadcast velocity + true track. So planes glide instead of teleporting.
> 2. **Persistent memory layer** — every aircraft seen is folded into IndexedDB (Dexie schema v3). One row per ICAO24 with rolling 100-timestamp history, used for cluster detection of "regular visitors" (same weekday + hour, ≥3 hits).
> 3. **Browser notifications** — opt-in, rate-limited, fired when a tracked flight is within 5 km of the user's home. Fully native, no service-worker push backend.
> 4. **Satellite overlay** — satellite.js SGP4 propagator runs in the main thread at 1 Hz over Celestrak TLEs cached in localStorage. Click any satellite for a dashed ground-track preview (90 min past + future).
> 5. **Map performance** — MapLibre with pooled DOM markers (no React reconciliation on every tick). Marker SVG uses currentColor + style.color so altitude tinting doesn't rebuild the DOM. ~200 markers maintained smoothly on a Pixel-class phone.
> 6. **Bundle** — 131 KB gzipped main + MapLibre isolated to its own 218 KB gzip chunk that lazy-loads after first paint.
>
> 101 unit tests, strict TypeScript, no `any`. MIT.
>
> Live: https://vnmoorthy.github.io/Skylog/
> Repo: https://github.com/vnmoorthy/Skylog

### /r/opensource

**Title:**

> Skylog — open-source, MIT, self-hostable flight tracker that remembers every plane it sees

**Body:** (same as /r/selfhosted but tweak emphasis slightly)

---

## 3. Twitter / X thread

```
1/  After getting woken up by the same plane at 3 AM for the 4th week in a row, I built Skylog — a flight tracker that *remembers* every aircraft it has seen over your house.

Open-source, runs in your browser, no account, no backend, no tracker.

https://vnmoorthy.github.io/Skylog/

[attach demo GIF]

2/ Every other flight tracker is amnesic. Click away → forgotten. Skylog persists every sighting to IndexedDB.

After a week of leaving a tab open, it'll tell you:

  UAL841 — Tuesdays around 07:00, ×7 sightings.

That's *your* sky, learned. No incumbent does this.

3/ Other things it does:

→ Paste a callsign, track a flight globally, ETA to home, browser ping at 5 km out
→ ISS + satellite overlay (satellite.js SGP4 client-side)
→ On-device acoustic model (inverse-square + ISO 9613-2) — dB estimate per pass
→ Worldwide

4/ Stack: Vite · React 18 · TypeScript strict · Tailwind · Zustand · Dexie · MapLibre · satellite.js · zero backend.

131 KB gzipped main bundle. 101 unit tests. MIT.

Repo: https://github.com/vnmoorthy/Skylog
Live: https://vnmoorthy.github.io/Skylog/

5/ If you live near an airport, this might actually solve a problem you have.

If you're a dev, the codebase is small and well-tested and readable.

If neither, please ⭐ the repo if you find it interesting. Stars genuinely help solo open-source projects find an audience.
```

---

## 4. Awesome-list PRs

Submit PRs to add Skylog to these curated lists. Each accepted PR is sustained discoverability:

- [awesome-aviation](https://github.com/Roms1383/awesome-aviation)
- [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted) (under "Software → Misc")
- [awesome-react-components](https://github.com/brillout/awesome-react-components) (might be a stretch)
- [awesome-maplibre](https://github.com/maplibre/awesome-maplibre) (if active)
- [awesome-typescript-projects](https://github.com/dzharii/awesome-typescript) (if active)
- [awesome-noads](https://github.com/curated-awesome-lists/awesome-noads-tools) (privacy angle)

**PR template** for each:

> Adding [Skylog](https://github.com/vnmoorthy/Skylog) — an open-source self-hostable flight tracker with persistent per-aircraft memory and pattern detection. No account, no tracker, MIT-licensed. Runs entirely in the browser via airplanes.live + MapLibre + IndexedDB.

---

## 5. Post-launch

- Pin a Twitter thread with the demo GIF and live link
- Add `[![Stars](https://img.shields.io/github/stars/vnmoorthy/Skylog?style=flat-square&color=ff8a4c)](...)` badge to the README (already there)
- Reply to **every** comment on HN/Reddit within 60 minutes for the first 6 hours
- Add a `Star History` chart from [star-history.com](https://star-history.com/#vnmoorthy/Skylog) to README after launch (looks impressive)
- Write a follow-up "How I built Skylog in a weekend" blog post about the dead-reckoning + memory schema. Cross-post to dev.to and Hashnode.
