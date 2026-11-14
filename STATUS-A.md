# STATUS-A

_Updated: Sat 14 Nov 2026, 14:50 CT_

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
- Real files committed now: flat 0 deg horizons for the five `terrain: sphere` sites, and
  `features.json` with six informal polar features.

## In progress
- First real run on the human's laptop (kernels, ephem.bin, Horizons fixtures, residual check,
  LOLA horizons for im1, im2, chandrayaan3, connecting_ridge).

## Next
- Commit the real outputs once the run comes back. Target: before the 17:00 merge for
  `ephem.bin` + fixtures; 21:00 for the residual table and the IM-1 horizon.
- Uncertainty bands from the DEM error maps (currently lo = hi = elev, `sigma_m: null`).
- IAU feature names with Gazetteer IDs.

## Blocked / needs other agent
- **Human:** this cloud workspace gets HTTP 403 from naif.jpl.nasa.gov, ssd.jpl.nasa.gov,
  pgda.gsfc.nasa.gov and imbrium.mit.edu. Every download and every Horizons query must run
  on a local machine: `pip install -r pipeline/requirements.txt`, then `python pipeline/run_all.py`.
- **Human:** three kernel URLs in `get_kernels.py` could not be checked from here
  (`lsk/naif0012.tls`, `pck/pck00011.tpc`, `pck/moon_pa_de440_200625.bpc`). The script stops with
  the folder to look in if one is wrong.
- **Human:** Agent A has read-only access to the repo. Branch `a/data` exists only in the
  workspace until push access is granted or the files are uploaded by hand.
- **C (sites.yaml, `connecting_ridge`):** sourced point is lat -89.438909, lon_e 222.85643,
  elev_m 1959.5. It is the highest pixel of the NASA GSFC PGDA product 78 Site01 5 m DEM
  (https://pgda.gsfc.nasa.gov/products/78), about 14 m from RoI 1 of Barker et al. 2021.
  It is **not** a coordinate taken from Gläser et al. 2014, so the "92.27% at 2 m" story line
  may describe a different point on the ridge. `make_horizons.py` computes the horizon at the
  PGDA point and writes it into the file as `site_used` until the YAML changes.
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
