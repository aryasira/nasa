# Agent A — Data & Science (starter brief)

You are **Agent A** in a 3-agent hackathon build for the NASA Space Apps 2026 challenge
*Lunar Landing Site Navigator*. Product: **Slip Impact Brief**. Deadline: Sun 15 Nov 2026, 23:30 CT (team target).

## Start
1. Clone `https://github.com/aryasira/nasa`, then `git checkout -b a/data`.
2. **Read `CONTEXT.md` and everything in `contracts/` before writing any code.** They override this brief if they disagree.
3. `pip install -r requirements.txt`, then `python tools/build_sites.py && python tools/make_mocks.py && python -m pytest -q tests`
   to confirm the scaffold is green.

## You own (write) ONLY
`pipeline/**` · `app/public/data/` real outputs (`ephem.bin`, `ephem.header.json`, `horizon/*.json`, `features.json`,
`fixtures.json`) · `docs/science.md` · `docs/horizons-flags.md` · `STATUS-A.md`

Do **not** touch `app/src`, `contracts`, `tests`, `data-src`, `app/public/data/mock`, `app/public/data/sites.json`.
If a contract or site value looks wrong, write it under "Blocked / needs other agent" in `STATUS-A.md` and move on.
`connecting_ridge` is now sourced (Gläser 2014 spot 2); read its elevation from LOLA. Named features: start from `data-src/features-seed.yaml` (IAU Gazetteer IDs).

## Tasks (in order)
1. **Kernels → `ephem.bin`** (`pipeline/make_ephem.py`, spiceypy). Download into `pipeline/kernels/` (git-ignored):
   `naif0012.tls`, `pck00011.tpc`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `de440s.bsp`.
   Record each file's byte size and URL in `docs/science.md`.
   Hourly, 2024-01-01T00Z → 2030-12-31T23Z (n = 61368), frame `MOON_ME`, observer Moon centre, `abcorr = "LT+S"`.
   Per row: Sun unit vector + distance in AU, Earth position in km (**position, not unit vector** — the app subtracts the site).
   Write exactly the layout in `contracts/ephem.header.json`, little-endian float32; fill `spice_version`, `git_sha`.
   - ⚠️ Network: cloud sandboxes may get HTTP 403 from naif.jpl.nasa.gov. If so, say so in `STATUS-A.md` immediately —
     the human will download the five kernels by hand into `pipeline/kernels/`. Don't try workarounds.
2. **Horizons fixtures** (`pipeline/fetch_horizons.py` → `app/public/data/fixtures.json`). For every site with
   `validation_use: numeric`: COMMAND=`10` (Sun) and `399` (Earth), `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`,
   `SITE_COORD='<lon_e>,<lat>,<elev_km>'`, `QUANTITIES='4'`, `APPARENT='AIRLESS'`, ~10 epochs per site spread over a
   lunar day. Store the exact query URL. Read one live output header and write what the `*` and `i` flags mean for a
   lunar observer in `docs/horizons-flags.md` (quote the header; don't guess).
3. **Self-check** (`pipeline/check_vs_horizons.py`): compute topocentric az/el from your `ephem.bin` (with linear
   interpolation + renormalisation, Earth = earth_km − site_km) and compare with the fixtures.
   **Acceptance: ≤ 0.01° for Sun and Earth at every numeric site.** Also print geocentric-vs-topocentric Earth
   difference to prove parallax (~0.26° at worst). Commit the residual table to `docs/science.md`.
4. **LOLA DEMs** for polar sites (`im1`, `im2`, `chandrayaan3`, `connecting_ridge`): start with LDEM_80S_80M
   (or 75S_240M for Chandrayaan-3's latitude). Verify byte size and the PDS label (`SCALING_FACTOR`, `OFFSET`,
   projection) and record them in `docs/science.md`. Never commit raw DEMs (`pipeline/cache/` is git-ignored).
5. **Horizons with attribution** (`pipeline/make_horizons.py` → `app/public/data/horizon/<site_id>.json`):
   720 azimuths (0.5°), ray-march out to ≥150 km with Moon curvature, observer at `mast_m` = 2 m above terrain.
   For each azimuth keep the **argmax** cell: distance (m), lat, lon_e. Sites with `terrain: sphere` get a flat 0°
   horizon with null occluders and `dem.product: "sphere"`.
6. **Feature names** (`app/public/data/features.json`): for each occluder, match to a named feature (USGS/IAU Gazetteer)
   within its radius; tag `name_status: iau` only with a Gazetteer ID, otherwise `informal`; null if no match.
   "Connecting Ridge", "Peak near Shackleton", "Malapert massif" are **informal**.
7. **Uncertainty**: `elev_lo_deg` / `elev_hi_deg` from terrain lowered/raised by the DEM's published σ (state the σ and
   its source in `docs/science.md`). Must satisfy lo ≤ elev ≤ hi.
8. Remaining sites, then a validation report section in `docs/science.md`.

## Conventions (from CONTEXT.md — don't deviate)
MOON_ME · east longitude 0–360 · azimuth clockwise from north · UTC ISO with `Z` · `LT+S` · topocentric Earth.
Every Python file starts with `# AI-assisted; see README.`
Every JSON output has `meta: {ai_generated: true, generated_by, git_sha}`. Never fabricate a number or a source.

## Deadlines for you
- **Sat 17:00** — `ephem.bin` real (or a clear blocker in STATUS-A) + Horizons fetcher working.
- **Sat 21:00** — fixtures + residual check passing; horizons + occluders for IM-1 at minimum.
- **Sun 09:00** — all polar horizons with features and ±σ.
- **Sun 13:00** — validation report done. After this: bug fixes only. **Sun 19:00 freeze.**

## Done means
`python -m pytest -q tests` passes with your real files present · residuals ≤ 0.01° · `docs/science.md` lists kernels,
sizes, DEM labels, σ source and the residual table · commits on `a/data` prefixed `A:` · `STATUS-A.md` updated.
