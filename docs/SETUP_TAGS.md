# Repo discoverability checklist

GitHub topics + repo description drive a meaningful share of organic stars. Skylog with the right metadata appears in topic-feed pages like `github.com/topics/flight-tracker`.

## 1. Repo description

Set the **About → Description** field to:

> 🛩️ A flight tracker that remembers every plane it sees over your house. Worldwide live ADS-B map, per-aircraft memory, pattern detection, satellite overlay. No account, no tracker, MIT.

And set the **Website** field to:

> https://vnmoorthy.github.io/Skylog/

## 2. Topic tags

Add ALL of these via the gear icon next to "About" on the repo home page:

```
flight-tracker
flight-tracking
ads-b
adsb
aviation
airplanes
maplibre
react
typescript
vite
web-worker
indexeddb
satellite-tracking
iss-tracker
open-source
self-hosted
privacy-first
no-account
mit-license
client-side
spa
single-page-application
dark-mode
real-time
```

Stop at 20 — that's GitHub's cap. Pick the most-searched first.

## 3. Repo settings

- ✅ Enable **Issues**
- ✅ Enable **Discussions**
- ✅ Enable **Projects** (lightweight kanban for the public roadmap)
- ❌ Disable **Wiki** (use README + docs/ instead)
- ✅ **Preserve this repository** (Arctic Code Vault)

## 4. Pages

- Settings → Pages → Source: **GitHub Actions** (already configured)
- Custom domain: optional, only if you own one

## 5. Branch protection

- Require PR before merging to `main`
- Require status checks (the deploy workflow) to pass

## 6. Star History badge

After launch, add to the bottom of the README:

```markdown
## ⭐ Star history

[![Star History Chart](https://api.star-history.com/svg?repos=vnmoorthy/Skylog&type=Date)](https://star-history.com/#vnmoorthy/Skylog&Date)
```
