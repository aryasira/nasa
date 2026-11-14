# STATUS-A

_Updated: Sat 14 Nov 2026, 15:10 CT_

<!-- AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team. -->

## Done
- Read CONTEXT.md and contracts v1. Scaffold tests green (`python -m pytest -q tests`).
- Pipeline code written under `pipeline/`, with self-tests on synthetic inputs
  (`python -m pytest -q pipeline/tests`, 10 passing):
  - `get_kernels.py` downloads the five NAIF kernels and records URL, bytes, SHA-256.
  - `make_ephem.py` writes `ephem.bin` + `ephem.header.json` with spiceypy, exactly per the contract.
  - `fetch_horizons.py` writes `fixtures.json` (Sun and Earth, `coord@301`, 10 epochs per numeric site
    on the half hour) and `docs/horizons-flags.md` (verbatim legend from a live reply).
  - `check_vs_horizons.py` recomputes az/el from `ephem.bin` the way the app must and enforces 0.01 deg.
    A test proves it fails when the Earth parallax is skipped.
  - `horizon_lib.py` + `make_horizons.py`: 720 azimuths, curvature, 2 m mast, 220 km, nested DEMs,
    occluder distance / lat / lon per azimuth, feature matching, contract-valid output.
  - `make_science_doc.py` builds `docs/science.md` from `pipeline/reports/*.json` only.
  - `run_all.py` runs everything and packs `pipeline/cache/agent_a_outputs.zip`.
- Merged `c/work` (86684d8) into `a/data` to pick up the sourced Connecting Ridge point, the
  landing times and `data-src/features-seed.yaml`. All tests green (27 passing).
- `features.json` is now built from the seed: 9 IAU features with Gazetteer IDs plus two informal
  summits (Connecting Ridge, Peak near Shackleton). Matching rule: within 1.1 x radius of the
  centre, smallest containing feature wins; documented in `docs/science.md`.
- Real files committed now: flat 0 deg horizons for the five `terrain: sphere` sites and `features.json`.
- Branch `a/data` is pushed.

- **First full run is in** (pipeline commit bd11f8f, run on the human's machine, outputs committed):
  - `ephem.bin` (61368 hourly rows, 1718304 bytes) and `ephem.header.json`, built with CSPICE_N0067.
    All five kernels downloaded; URL, bytes and SHA-256 are in `pipeline/reports/kernels.json`.
  - `fixtures.json`: 140 JPL Horizons fixtures (7 numeric sites x 10 epochs x Sun and Earth).
  - Residual check: **PASS, all 140 fixtures within 0.01 deg**. Largest elevation gap about
    0.0007 deg (Sun) and 0.00014 deg (Earth). Earth parallax applied: up to 0.2767 deg.
    Table in `pipeline/reports/residuals.json` and `docs/science.md`.
  - LOLA horizons with occluder attribution: `im1`, `im2`, `chandrayaan3`, `connecting_ridge`.
    | site | min..max elev (deg) | peak az (deg) | DEM height (m) | azimuths with a named occluder |
    |---|---|---|---|---|
    | im1 | -0.24 .. 11.05 | 152.0 | 2591.9 | 0% |
    | im2 | -1.47 .. 4.06 | 117.5 | 5321.5 | 100% |
    | chandrayaan3 | 0.38 .. 2.45 | 350.0 | 529.7 | 0% |
    | connecting_ridge | -2.74 .. -0.52 | 184.5 | 1958.6 | 82% |
  - `docs/horizons-flags.md` (verbatim legend from a live Horizons reply) and `docs/science.md`.
  - Tests: 28 passing (`python -m pytest -q tests pipeline/tests`).

## In progress
- Uncertainty bands from the DEM error maps (currently lo = hi = elev, `sigma_m: null`).

## Next
- Sun 09:00: bands for all four LOLA horizons. Sun 13:00: validation report.
- Finer near-field terrain for `im1` if a PGDA 5 m tile covers it (its peak occluder is 400 m away
  on the 80 m grid, so the 11.05 deg peak is sensitive to grid size).

## Blocked / needs other agent
- **Human:** this cloud workspace gets HTTP 403 from naif.jpl.nasa.gov, ssd.jpl.nasa.gov,
  pgda.gsfc.nasa.gov and imbrium.mit.edu. Every download and every Horizons query must run
  on a local machine: `pip install -r pipeline/requirements.txt`, then `python pipeline/run_all.py`.
- **C (sites.yaml elevations, from the DEMs):** `im2` 5321.5 m (80S 80 m grid);
  `connecting_ridge` 1958.6 m (Site01 5 m). `im1` reads 2591.9 m on the 80 m grid against 2579 in
  the catalogue, a 13 m gap. Fixtures for `im2` and `connecting_ridge` were requested at altitude 0 km.
- **C (features-seed.yaml):** no seed feature lies near `im1` or `chandrayaan3`, so their occluders
  are all unnamed. Add nearby IAU features with Gazetteer IDs if the brief should name them.
- **C (sites.yaml, `connecting_ridge`):** the Gläser spot 2 point is used as given. For
  reference it lies about 30 m from the summit of the PGDA 78 Site01 5 m DEM
  (-89.438909, 222.85643, 1959.5 m, about 14 m from RoI 1 of Barker et al. 2021). After the
  real run, please copy `site_used.elev_dem_m` from `horizon/connecting_ridge.json` into `elev_m`.
- **C (sites.yaml, `im2`):** `elev_m` is null. Horizons fixtures are requested at altitude 0 km
  for it, and the horizon uses the DEM height, reported as `site_used.elev_dem_m`.
- **C:** `chandrayaan3` (69.37 S) lies outside both the 80S and the 75S LOLA polar grids named in
  the brief. It uses the 60S 240 m grid.
- **C:** the brief names the PDS `LDEM_80S_80M.IMG`. The pipeline uses the track-adjusted GeoTIFF
  versions from NASA GSFC PGDA product 90 (Barker et al. 2023) instead. Please cite that product.
- **C:** root `requirements.txt` has no rasterio / pyproj / scipy. They are in
  `pipeline/requirements.txt`; CI does not need them.
- **B:** horizon files carry two extra objects the schema allows: `site_used` (the exact point and
  DEM height) and `dem.layers`. Occluder entries are null where no real DEM cell sets the horizon.
  `terrain: sphere` sites have a flat 0 deg horizon as the brief asks; the true smooth-sphere dip
  for a 2 m mast is -0.087 deg.
- **B / C:** uncertainty is not real yet. Do not show a band until `dem.sigma_m` is non-null.
