# Agent B — Engine & App (starter brief)

You are **Agent B** in a 3-agent hackathon build for the NASA Space Apps 2026 challenge
*Lunar Landing Site Navigator*. Product: **Slip Impact Brief**. Deadline: Sun 15 Nov 2026, 23:30 CT (team target).

## Start
1. Clone `https://github.com/aryasira/nasa`, then `git checkout -b b/app`.
   if the other agents run on the same machine).
2. **Read `CONTEXT.md` and `contracts/types.ts` before writing any code.** They override this brief if they disagree.
3. Build against the mock data in `app/public/data/mock/` (regenerate with `python tools/make_mocks.py`).
   Put the data path behind one switch, e.g. `?data=mock` vs default `data/`, so swapping to Agent A's real files is one line.

## You own (write) ONLY
`app/src/**` · `app/index.html` · `app/vite.config.ts` · `app/package.json` (+ lockfile) · `app/tsconfig*.json` · `STATUS-B.md`

Do **not** touch `contracts`, `pipeline`, `tests`, `data-src`, or anything in `app/public/data`.
Import types from `../../contracts/types.ts` (add a Vite/TS path alias); never redefine them.
If a contract seems wrong, write it under "Blocked / needs other agent" in `STATUS-B.md` and work around it.

## Stack
Vite + TypeScript, no backend, static GitHub Pages build (`base: './'`). Plain DOM or a light framework (Preact/React —
your call, keep the bundle small). SVG/D3 for charts. Okabe-Ito colour-blind-safe palette. `npm run build` → `app/dist`
(CI deploys it). Add `npm test` with Vitest for the engine.

## Tasks (in order)
1. **Loader** (`src/engine/ephem.ts`): fetch `ephem.header.json` + `ephem.bin` → `Float32Array`; `sample(tUtc)` with
   linear interpolation between hourly rows, then **renormalise the Sun unit vector**.
2. **Geometry** (`src/engine/geometry.ts`): site vector in MOON_ME from lat/lon_e/elev (R = 1737.4 km + elev);
   **Earth topocentric = earth_km − site_km** (mandatory — a Vitest test must show the geocentric direction differs
   by up to ~0.26°); local ENU; az (clockwise from N) / el.
3. **Visibility** (`src/engine/visibility.ts`): disc fraction above the horizon profile at that azimuth
   (interpolate the 720-point `elev_deg`; Sun radius 0.267°, Earth radius from distance). Same with `elev_lo/hi_deg`
   for bands. Earth-eclipses-Sun flag from geometry (angular separation vs radii, seen from the site).
4. **Metrics + events** (`src/engine/metrics.ts`): for a window → `WindowMetrics` (sunlit h, Earth-visible %,
   both-visible h, longest dark gap, next sunset/Earthset, eclipse h). Step 10 min; refine event times by bisection.
5. **Slip ranking** (`src/engine/slip.ts`): baseline vs +N days vs nearest better dates (search ±60 d) vs alternate
   sites → `SlipOption[]` sorted by Δ both-visible hours.
6. **Cause lines** (`src/engine/causes.ts`): for each lost/gained interval, find the azimuth where the body crossed the
   horizon, read `occluder` at that index → `CauseLine`, e.g.
   *"Sun lost 31 h — blocked by Malapert massif at az 172°, 14 km"*; use "unnamed terrain" when `feature_id` is null,
   and "smooth-sphere horizon" when the site has `dem.product: "sphere"`. Show the ±σ band next to every delta.
7. **UI**: site picker (from `sites.json`, show source + `name_status`), date picker, timeline (Sun / Earth / both),
   slip panel with ranked options + cause lines, **one-page brief view with print CSS**, permalink (state in query string).
   Show a visible "MOCK DATA" banner whenever `meta.mock` is true.
8. **IM-1 preset**: site `im1`, baseline 2024-01-19 vs actual 2024-02-22. The story line comes from `sites.json.story`
   ("a manifest slip of days became a slip of a month…") — never say lighting *caused* the slip.
9. **COULD (only after the Sun 13:00 gate):** sky-dome "horizon clock", assumption toggles (sphere ↔ terrain,
   centre ↔ limb, mast height), Moon Trek basemap (test CORS with a live `fetch` early; fall back to a static image).

## Rules
Every source file starts with `// AI-assisted; see README.`
Page footer: AI-use sentence + "NASA does not endorse this project" + data credits. **No NASA logos.**
Never display a feature in the UI that isn't working; never hard-code eclipse or libration lists.

## Deadlines for you
- **Sat 17:00** — app runs on mocks: loader, geometry, a timeline for one site.
- **Sat 21:00** — metrics + site compare deployed (first slice).
- **Sun 09:00** — slip ranking working on real data.
- **Sun 13:00** — cause lines, brief/print, permalink, IM-1 preset done (signature gate).
- **Sun 19:00** — feature freeze; bug fixes only after.

## Done means
`npm run build` and `npm test` pass · IM-1 preset shows Jan vs Feb 2024 deltas with cause lines · Lighthouse
accessibility ≥ 90 · works offline after first load · commits on `b/app` prefixed `B:` · `STATUS-B.md` updated.
