# STATUS-A

_Updated: Sun 15 Nov 2026, 13:20 CT (real clock)_

_Correction: entries below stamped 12:25 and 14:05 were written between 12:00 and 12:20 CT. Those stamps were guesses._

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

- 19:25 recheck: tests 28 passing, residual check PASS, all nine horizons valid, no secrets,
  no banned claims. Fixed one gap: `pipeline/reports/*.json` had no `meta` block. `write_json`
  now adds it; the five existing reports are stamped with the commit that produced them.

- 19:55: uncertainty band code is written and tested on synthetic DEMs (30 tests passing).
  Not run on real data yet, so the committed horizon files still have `sigma_m: null`.
  - Source: the per-pixel height error map published with each DEM (PGDA 90 `*_ERR.TIF`,
    PGDA 78 `Site01_final_adj_5mpp_toterr.tif`). File names read from the product pages.
  - Method: envelope. Terrain raised by its error and observer lowered by the site error
    for the upper edge, the reverse for the lower edge. Grid-spacing error is not included.
  - New optional near-field layer for im1 and im2: `--fine 40` or `--fine 20`.
  - `run_all.py --horizons-only` redoes horizons, doc and tests without touching ephem or fixtures.

- **Round 2 code (23:55), all in one Mac run: `python3 pipeline/run_all.py --fine 40`.**
  - Merged `main` (6fda338). Re-read CONTEXT.md and PLAN.md.
  - Task 1: `contracts/ephem.header.json` now `t0_utc 2023-01-01T00:00:00Z`, `n 70128`, notes updated.
    Only those three fields changed. Mocks and golden vectors regenerated with C's tools.
    Fixtures: the 140 round-1 epochs do not move. `chandrayaan3` gains 10 epochs, 27 h apart,
    from 2023-08-23T12:30Z to 2023-09-02T15:30Z. Expected total: 160 fixtures.
  - Task 2: bands are on by default for every terrain site. A full band wider than 0.5 deg at the
    highest horizon point prints `WIDE BAND` and sets `band_flag` in `pipeline/reports/horizons.json`.
  - Task 3: `shackleton_sr1` and `shackleton_sr2` horizons use PGDA 78 Site04 5 m, then the 40 m
    grid to 100 km (with `--fine 40`), then 80 m to 220 km. Until C adds them to `sites.json` the
    brief's coordinates are used and the file says so in `site_used.point_from`.
    **`de_gerlache_rim` is skipped.** No published high-illumination point with coordinates was found.
  - Task 5: `docs/science.md` opens with a validation report (Horizons, Connecting Ridge against
    Glaeser 2014, band widths, data products with citations and kernel sizes). It fills from the run.
  - Tests: 32 total. 31 pass. **1 fails until the Mac run:** `tests/contracts::test_ephem[data]`,
    because the committed real `ephem.bin` still starts in 2024.

- 00:05: occluder naming no longer uses a feature that contains the site. Committed files are
  relabelled (`make_horizons.py --rematch`, no DEM needed) and the Mac run uses the same rule.
  im2: named directions 720 to 49 (Malapert, Nobile). connecting_ridge: 591 to 138
  (de Gerlache, Mons Malapert, Mons Mouton). The skipped ids are in `site_used.stands_on`.

- 10:05: merged `main` (abc7ad7). REVIEW.md items for A: item 1 done Sat 23:41 (df8581e);
  item 2 done now (`check_vs_horizons.py` accepts the last ephemeris row).
- **10:05: the Mac run has not been pushed yet.** `a/data` on GitHub has no commit after Sat 23:41.

- 11:50: looked at the live site in a browser. It makes 12 failed requests (404), one per
  site in `sites.json` without a horizon file. Ten are the new flat-horizon sites C added
  (apollo14 to 17, surveyor7, luna17, luna24, change3, change4, change5). Their horizon files are
  now generated and committed. The other two are `shackleton_sr1` and `shackleton_sr2`, which
  need the Mac run.

- 12:05: two additions for the Mac run, both tested on synthetic terrain.
  - Grid confidence: `occluder.res_m` and `occluder.cells` per azimuth in every terrain horizon.
    `cells` = occluder distance / grid size of the layer it was found in. Under 3 is low confidence.
  - Optional observer heights: `--masts 5,10` writes `horizon/<id>.mast5.json` and
    `horizon/<id>.mast10.json` next to the standard 2 m file. Same schema, `mast_m` set.
  - Recommended run is now `python3 pipeline/run_all.py --fine 40 --masts 5,10`.

- **12:25: THE MAC RUN IS IN (8835191) AND CHECKED. Round 2 "done means" is met.**
  - Ephemeris from 2023-01-01, n = 70128. All 34 tests pass.
  - Residuals: PASS, 160 of 160 fixtures within 0.01 deg. Largest gap 0.0007 deg.
  - Bands on all six terrain sites, `dem.sigma_m` set. Full width at the highest horizon point:
    im1 0.34, im2 0.002, chandrayaan3 0.005, connecting_ridge 0.20, shackleton_sr1 0.003,
    shackleton_sr2 0.004 deg. All well under 1 deg. Nothing flagged.
    Widest anywhere on a horizon: connecting_ridge 1.58 deg and im1 1.33 deg, at low azimuths
    where the occluder is a few hundred metres away.
  - **Task 4, DEM heights for C:** `im2` 5321.8 m (40 m grid). `connecting_ridge` 1958.6 m (5 m).
    Also `im1` 2592.1 m, `shackleton_sr1` 1734.0 m, `shackleton_sr2` 1727.8 m (40 m grid).
  - **IM-1 near-field check:** the occluder near az 69 deg survives on the 40 m grid. Distance
    280 m (7 cells), elevation 6.33 deg against 6.34 deg on the 80 m grid. Whole horizon moved by
    0.02 deg on average, 0.19 deg at most. It is real terrain at this scale, not an 80 m artifact.
  - **Known limit:** the run read the 40 m grid ahead of the Site04 5 m tile, so both Shackleton
    horizons are 40 m terrain. Their `dem` metadata now says so. The order is fixed in the pipeline.
  - The run did not use `--masts`, and it started before the confidence fields were pushed, so
    there are no mast files and no `occluder.cells` yet.

- 14:05: Connecting Ridge long-run sunlight on the new data: 91.25% over 2023 to 2030, 88.18% to
  93.09% across the terrain band. Published 92.27% (Glaeser 2014) lies inside the band. In `docs/science.md`.
- 14:05: at the human's request this session also did B and C items on branch **`b/a-fixes`**
  (= b/app + main + a/data + fixes). See STATUS-B.md on that branch. Merging `b/a-fixes` into
  `main` brings everything in one step.

- **13:20: ROUND 3 (docs/agents/ROUND3-A.md).**
  - 0 Mac run confirmed: 70128 rows from 2023-01-01, 160 fixtures, no merge markers, main merged.
  - 1 IM-1 blocker. Resolution test done: it survives on the 40 m grid (280 m away, 6.33 deg,
    against 320 m and 6.34 deg on 80 m). Moved-site and 1 m / 3 m mast variants are coded and
    tested (`pipeline/im1_near_field.py`) but **need one more Mac pass** (DEMs are only there).
    The lead story does not rest on it: baseline 155.5 h (148.8 to 157.0 across the band),
    slipped 82.0 h (81.7 to 82.3).
  - 2 Shackleton SR1 and SR2: built, pass the contract tests, ship. They are on 40 m terrain.
  - 3 Bands: `dem.sigma_m` set in all six terrain files. One line per lead stay in `docs/science.md`.
    Result: bands are tiny for five of six lead stays; only the IM-1 baseline moves (about 8 h).
  - 4 Flat-horizon files now sit at the 2 m dip, -0.0869 deg, not 0. `elev_dem_m` set for
    `connecting_ridge` (1958.6) and `im2` (5321.8). Mocks unchanged, so golden vectors unchanged.
  - 5 **`app/public/data/validation.json`** written by `pipeline/make_validation.py`, schema
    `contracts/validation.schema.json`, contract test added. Numbers come from the Python
    reference engine on the real data and match the app: 155.5 h, 82.0 h, 91.25%, 86.56%.
  - 6 `## One-line claims` in `docs/science.md`: seven sentences, each with its source file.
  - 7 Next-windows forecast: not done (optional).
  - Tests: Python 38 passed.

## In progress
- Waiting for one cached Mac pass:
  `python3 pipeline/run_all.py --horizons-only --fine 40 --masts 5,10`
  It now also runs the IM-1 near-field study and rewrites `validation.json`.

## Next
- Check that pass, then the IM-1 verdict goes to C.

## Blocked / needs other agent
- **B: `validation.json` field names (round 3, item 5).**
  `horizons_check`: `n_fixtures`, `n_epochs`, `n_sites`, `site_ids`, `bodies`, `tol_deg`, `passed`,
  `max_az_gap_deg`, `max_el_gap_deg`, `max_earth_parallax_deg`, `sun_diameter_deg` [min, max],
  `max_gap_as_fraction_of_sun_diameter` {`one_over`, `exact_ratio`, `text`}.
  `benchmark`: `site_id`, `span_utc`, `years`, `ours_limb_pct`, `ours_limb_band_pct` [lo, hi],
  `ours_centre_pct`, `published` {`pct`, `source`, `method`}, `published_inside_our_band`, `differences`.
  `lead_lines[]`: `site_id`, `which`, `start_utc`, `stay_days`, `sunlit_h`, `sunlit_h_range`,
  `both_visible_h`, `both_visible_h_range`, `text`.
  `bands.sites.<id>`: `sigma_m`, `site_sigma_m`, `full_width_at_peak_deg`, `median_full_width_deg`,
  `max_full_width_deg`, `flag_wide`. `im1_near_field`: `status` ("run" or "not run"), then
  `blocker_survives_all`, `verdict`, `lead_story`. `products`: `kernels[]`, `spice`,
  `terrain_files[]`, `terrain_sources[]`. `meta.mock` is false.
- **B: flat-horizon sites moved from 0 to -0.0869 deg.** `SPHERE_HORIZON_DEG = 0` in
  `app/src/engine/metrics.ts` says it matches the pipeline value. It no longer does. Your call.
- **C: one-line claims are in `docs/science.md` under `## One-line claims`.** Current figures:
  0.0007 deg, 160 checks, 7 sites, about 1/750 of the Sun's width; Connecting Ridge 91.25%
  (88.18% to 93.09%), centre rule 86.56%, published 92.27% inside our band; IM-1 155.5 to 82.0 h.
- **C: CI on a PR from `a/data` alone is red**, because `main`'s app tests still expect the old
  terrain numbers. Branch `b/a-fixes` has those tests fixed. Open the PR from `b/a-fixes`.
- **All agents (12:42): three sessions fixed the same bugs in parallel today.** Branch `b/a-fixes`
  (f137d76) already merges `main` 9afba58 and `b/app` 854ffe6 with the new data and is conflict-free.
  Merge that one branch into `main`, then have B and C pull `main` before doing anything else.
- **C (12:25): `a/data` is now safe to merge into `main` in full.** The earlier "do not merge" note
  is void. Contract, mocks, golden vectors and real data all agree on the 2023 start.
- **B (12:05):** after the Mac run, use `occluder.cells[az]` for a confidence tag on terrain
  causes: under 3 cells say "nearby terrain, low confidence" and do not headline it. If the
  mast files exist, a 2 / 5 / 10 m selector can load `horizon/<id>.mast<h>.json`.
- **C (11:50): the horizon folder on `a/data` is safe to take now, without the contract change:**
  `git checkout origin/a/data -- app/public/data/horizon/` then commit. That removes ten 404s on
  the live site and ships the occluder naming fix (im2 no longer reads Mons Mouton everywhere).
  Do not take `contracts/`, `app/public/data/mock/` or `tests/golden/` until the Mac run is in.
- **B (seen live, IM-1, 19 Jan 2024, +60 d):** the three alternate-site rows show the IM-1 cause
  line ("... at IM-1 Odysseus"). The headline cause is terrain "< 0.5 km" away at az 69 deg. That
  occluder sits within a few cells of the 80 m grid, so treat it as soft until the 40 m run.
- **B:** `site_used.stands_on` lists the features the site stands on (im2: `mons_mouton`). Use it
  for a "site is on Mons Mouton" label if wanted. Occluders on that ground are now null, so they
  read as unnamed local terrain.
- **Human / C: do not merge `a/data` into `main` before the Mac run.** The contract says 2023 but the
  real `ephem.bin` is still 2024 until then. One contract test is red in between.
- **B:** after the Mac run the fixture count is 160, not 140, and the ephemeris has 70128 rows.
  Recompute the Connecting Ridge 91.2 percent figure on the new span. `connecting_ridge` terrain
  layers are unchanged on purpose so that figure moves only because of the span.
- **C:** lead sentence 3 says 140 points at seven sites. After the run it is 160 points, same seven sites.
- **C:** add `shackleton_sr1` and `shackleton_sr2` to `data-src/sites.yaml` with `terrain: lola`.
  The DEM file for both is `Site04_final_adj_5mpp_surf.tif` (PGDA 78). Its name follows the Site01
  pattern; the Mac run confirms it downloads.
- **Human:** `main` is still the scaffold commit 84dcbb4 at 19:25 CT. The 17:00 merge did not
  happen. `a/data` (and `b/app`, `c/work`) are waiting to be merged.
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
  When it is: `dem.sigma_m` is the median height error at the occluder cells, in metres. A new
  top-level `band` object gives the method text, `site_sigma_m` and `occluder_sigma_m` per azimuth.
  Call it an envelope from published DEM errors, not a confidence interval.
