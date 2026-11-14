# STATUS-A

_Updated: Sat 14 Nov 2026, 14:57 CT_

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

## In progress
- First real run on the human's laptop (kernels, ephem.bin, Horizons fixtures, residual check,
  LOLA horizons for im1, im2, chandrayaan3, connecting_ridge).

## Next
- Commit the real outputs once the run comes back. Target: before the 17:00 merge for
  `ephem.bin` + fixtures; 21:00 for the residual table and the IM-1 horizon.
- Uncertainty bands from the DEM error maps (currently lo = hi = elev, `sigma_m: null`).

## Blocked / needs other agent
- **Human:** this cloud workspace gets HTTP 403 from naif.jpl.nasa.gov, ssd.jpl.nasa.gov,
  pgda.gsfc.nasa.gov and imbrium.mit.edu. Every download and every Horizons query must run
  on a local machine: `pip install -r pipeline/requirements.txt`, then `python pipeline/run_all.py`.
- **Human:** three kernel URLs in `get_kernels.py` could not be checked from here
  (`lsk/naif0012.tls`, `pck/pck00011.tpc`, `pck/moon_pa_de440_200625.bpc`). The script stops with
  the folder to look in if one is wrong.
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
