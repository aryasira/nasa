# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Assemble docs/science.md from the JSON reports the pipeline wrote.

Every number in the generated sections comes from pipeline/reports/*.json,
which the other scripts write from real files and live Horizons replies.
Sections with no report yet say so instead of showing a value.

Usage:  python pipeline/make_science_doc.py
"""
import common as C

PENDING = "_Not produced yet: run the pipeline step named above._"


def kernels_section():
    rep = C.read_report("kernels.json")
    out = ["## 1. SPICE kernels (`pipeline/get_kernels.py`)", ""]
    if not rep or not rep["kernels"]:
        return out + [PENDING, ""]
    out += ["| Kernel | Bytes | SHA-256 (first 16) | URL |", "|---|---:|---|---|"]
    for k in rep["kernels"]:
        out.append(f"| `{k['name']}` | {k['bytes']} | `{k['sha256'][:16]}` | {k['url']} |")
    return out + [""]


def ephem_section():
    rep = C.read_report("ephem.json")
    out = ["## 2. Ephemeris (`pipeline/make_ephem.py` -> `app/public/data/ephem.bin`)", "",
           "Hourly rows, 2024-01-01T00Z to 2030-12-31T23Z, frame `MOON_ME`, observer Moon "
           "centre, aberration correction `LT+S`. Row layout: Sun unit vector, Sun distance "
           "in AU, Earth position in km. The app must subtract the site vector from the "
           "Earth position.", ""]
    if not rep:
        return out + [PENDING, ""]
    out += [f"- Toolkit: {rep['spice_version']}",
            f"- Rows: {rep['rows']}, file size: {rep['bytes']} bytes",
            f"- Sub-solar latitude range: {rep['sun_lat_deg'][0]:.3f} to {rep['sun_lat_deg'][1]:.3f} deg",
            f"- Sun distance: {rep['sun_au'][0]:.4f} to {rep['sun_au'][1]:.4f} AU",
            f"- Earth libration in latitude: {rep['earth_lat_deg'][0]:.3f} to {rep['earth_lat_deg'][1]:.3f} deg",
            f"- Earth libration in longitude: {rep['earth_lon_deg'][0]:.3f} to {rep['earth_lon_deg'][1]:.3f} deg",
            f"- Earth distance: {rep['earth_km'][0]:.0f} to {rep['earth_km'][1]:.0f} km",
            "", "These ranges are computed from the vectors in the file, not typed in.", ""]
    return out


def residual_section():
    rep, fx = C.read_report("residuals.json"), C.read_report("fixtures.json")
    out = ["## 3. Validation against JPL Horizons (`fetch_horizons.py`, `check_vs_horizons.py`)", "",
           "Truth: Horizons apparent, airless azimuth and elevation for an observer on the "
           "lunar surface (`CENTER='coord@301'`, geodetic east longitude, latitude, altitude). "
           "Ours: `ephem.bin`, linear interpolation between hourly rows, Sun vector "
           "renormalised, Earth = earth_km - site_km, rotated to the local frame. Azimuth "
           "gaps are scaled by cos(elevation).", ""]
    if fx:
        out += [f"Fixtures: {fx['n_fixtures']} values, tolerance {fx['tol_deg']} deg. Sites whose "
                "catalogue elevation is missing were sent to Horizons with altitude 0 km: "
                + (", ".join(sorted({q['site_id'] for q in fx['queries'] if q['catalog_elev_missing']})) or "none")
                + ".", ""]
    if not rep:
        return out + [PENDING, ""]
    out += ["| Site | Body | Epochs | Largest azimuth gap (deg) | Largest elevation gap (deg) |",
            "|---|---|---:|---:|---:|"]
    for r in rep["rows"]:
        out.append(f"| {r['site_id']} | {r['body']} | {r['n']} | {r['max_az_gap_deg']:.5f} | {r['max_el_gap_deg']:.5f} |")
    verdict = "PASS" if rep["passed"] else f"FAIL ({rep['n_failures']} fixtures outside tolerance)"
    out += ["", f"**Result: {verdict}**, {rep['n_fixtures']} fixtures, tolerance {rep['tol_deg']} deg.", "",
            f"Earth parallax: the geocentric and topocentric Earth directions differ by up to "
            f"{rep['max_earth_parallax_deg']:.4f} deg at these fixtures (geometric ceiling "
            f"{rep['parallax_upper_bound_deg']:.4f} deg). Skipping the site vector would break the tolerance.", ""]
    return out


def horizon_section():
    rep = C.read_report("horizons.json")
    out = ["## 4. Terrain horizons (`pipeline/make_horizons.py`, `pipeline/horizon_lib.py`)", "",
           "Method: 720 azimuths, great-circle rays, Moon curvature, observer "
           "2 m above the DEM surface at the site, range 220 km, step growing 0.4 percent per "
           "sample. The finest DEM with data at a sample wins. The occluder of an azimuth is "
           "the sample with the largest elevation angle. Beyond DEM coverage the terrain is "
           "assumed to lie on the reference sphere; where only that assumed surface sets the "
           "horizon, the occluder is null. Sites with `terrain: sphere` get a flat 0 deg "
           "horizon. For reference, the true smooth-sphere dip for a 2 m mast is -0.087 deg.", "",
           "DEM sources:",
           "- NASA GSFC PGDA product 90, https://pgda.gsfc.nasa.gov/products/90, "
           "Barker et al. 2023, Planet. Sci. J. 4, 183 (`LDEM_80S_80MPP_ADJ.TIF`, `LDEM_60S_240MPP_ADJ.TIF`).",
           "- NASA GSFC PGDA product 78, https://pgda.gsfc.nasa.gov/products/78, "
           "Barker et al. 2021, Planet. Space Sci. 203, 105119 (`Site01_final_adj_5mpp_surf.tif`).",
           "- These are the track-adjusted GeoTIFF versions of the LOLA polar grids, not the "
           "PDS `.IMG` files named in the brief. Scale and offset below are the GeoTIFF's own tags.", ""]
    if not rep or not any(not v.get("sphere") for v in rep["sites"].values()):
        return out + [PENDING, ""]
    layers = {}
    for v in rep["sites"].values():
        for d in v.get("dems", []):
            layers[d["file"]] = d
    out += ["| DEM file | Bytes | Pixels | Native m/pix | dtype | nodata | scale, offset | Sphere radius (m) |",
            "|---|---:|---|---:|---|---|---|---:|"]
    for name, d in sorted(layers.items()):
        out.append(f"| `{name}` | {d['bytes']} | {d['width']} x {d['height']} | {d['native_res_m']:g} | "
                   f"{d['dtype']} | {d['nodata']} | {d['scale']:g}, {d['offset']:g} | {d['sphere_radius_m']:.0f} |")
    out += [""] + [f"- `{n}` CRS: `{d['crs_proj4']}`" for n, d in sorted(layers.items())] + ["",
            "| Site | Point used (lat, lon E) | DEM height (m) | Catalogue (m) | Horizon min..max (deg) | "
            "Peak azimuth | Null occluders | Named | Coverage min (km) |", "|---|---|---:|---:|---|---:|---:|---:|---:|"]
    for sid, v in rep["sites"].items():
        if v.get("sphere"):
            continue
        s = v["site_used"]
        out.append(f"| {sid} | {s['lat']}, {s['lon_e']}{' (differs from sites.json)' if s['differs_from_catalog'] else ''} | "
                   f"{s['elev_dem_m']} | {s['elev_catalog_m']} | {v['elev_min_deg']}..{v['elev_max_deg']} | "
                   f"{v['elev_max_at_az_deg']} | {v['null_occluder_share'] * 100:.0f}% | "
                   f"{v['named_share'] * 100:.0f}% | {v['coverage_min_km']} |")
    return out + [""]


STATIC_TAIL = """## 5. Uncertainty bands

Status: **pending**. `elev_lo_deg` and `elev_hi_deg` currently equal `elev_deg` and
`dem.sigma_m` is null, so no band is claimed. Planned source: the per-pixel error maps
published with each DEM. Published figure for the PGDA 78 5 m site DEMs: median RMS height
error about 0.30 to 0.50 m (https://pgda.gsfc.nasa.gov/products/78).

## 6. Feature names

`features.json` is built from `data-src/features-seed.yaml` (IAU names with USGS Gazetteer
IDs, curated by Agent C) plus two informal summits, "Connecting Ridge" and "Peak near
Shackleton", each placed at the highest pixel of its PGDA 78 site DEM. An occluder gets a
feature's id when it lies within 1.1 times the feature's radius of the feature's centre
(the margin lets a crater rim carry the crater's name). When several features contain it,
the smallest wins. Occluders outside every feature stay null and must be shown as unnamed
terrain. A name says which mapped feature the blocking terrain belongs to, not which part
of it.

## 7. Earlier checks with the same ray-marcher (run by the human on 14 Nov 2026)

These used an earlier version of `horizon_lib.py` on the PGDA 78 site DEMs plus
`LDEM_80S_80MPP_ADJ.TIF`. The console output was pasted into the working session; the
numbers are not regenerated by this script.

- Horizons `coord@301` check at the Connecting Ridge point over 91 daily epochs, using JPL
  Horizons sub-solar and sub-Earth points as the ephemeris: largest elevation gap 0.0012 deg
  (Sun) and 0.0010 deg (Earth); largest azimuth gap 0.0007 deg (Sun) and 0.0063 deg (Earth).
- Convergence: rays every 0.25 deg with four times smaller steps changed no site's sunlit or
  Earth-visible share by more than 0.1 percentage point; largest change on shared rays 0.014 deg.
- Cross-site check: the skyline seen from each of six polar points matched the predicted
  elevation of the other points' summits in all 30 pairs.

## 8. Known limits

- Visibility thresholds are the app's job; this pipeline only supplies vectors and horizons.
- Sites not on a 5 m DEM use 80 m or 240 m terrain, so ground within a few hundred metres
  of the lander is smoothed.
- `connecting_ridge` uses the catalogue coordinate (Gläser et al. 2014, spot 2) and the
  PGDA 78 Site01 5 m DEM for its height. That DEM is newer than the one Gläser used, so
  the published percentage is a benchmark, not a value to reproduce exactly.
"""


def main():
    lines = ["# Science notes (Agent A)", "",
             "<!-- AI-ASSISTED: generated by pipeline/make_science_doc.py with Claude (Anthropic), "
             "reviewed by the human team. Sections 1 to 4 are filled from pipeline/reports/*.json. -->", "",
             f"Pipeline commit: `{C.git_sha()}`", "",
             "Conventions: body-fixed frame MOON_ME, east longitude 0 to 360, azimuth clockwise "
             "from north, elevation above the plane normal to the 1737.4 km reference sphere "
             "at the site, UTC.", ""]
    for section in (kernels_section, ephem_section, residual_section, horizon_section):
        lines += section()
    C.DOCS.mkdir(exist_ok=True)
    (C.DOCS / "science.md").write_text("\n".join(lines) + STATIC_TAIL, encoding="utf-8")
    print("wrote docs/science.md")


if __name__ == "__main__":
    main()
