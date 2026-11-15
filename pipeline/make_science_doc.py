# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Assemble docs/science.md from the JSON reports the pipeline wrote.

Every number in the generated sections comes from pipeline/reports/*.json,
which the other scripts write from real files and live Horizons replies.
Sections with no report yet say so instead of showing a value.

Usage:  python pipeline/make_science_doc.py
"""
import common as C

PENDING = "_Not produced yet: run the pipeline step named above._"


def validation_report():
    """Summary for the project page. Every number is read from a report."""
    res, eph, hor, ker = (C.read_report(n) for n in
                          ("residuals.json", "ephem.json", "horizons.json", "kernels.json"))
    out = ["## Validation report", ""]
    out += ["### A. Sun and Earth directions against NASA JPL Horizons", ""]
    if res:
        sites = sorted({r["site_id"] for r in res["rows"]})
        az = max(r["max_az_gap_deg"] for r in res["rows"])
        el = max(r["max_el_gap_deg"] for r in res["rows"])
        out += [f"- {res['n_fixtures']} fixtures at {len(sites)} landing sites ({', '.join(sites)}), "
                f"tolerance {res['tol_deg']} deg: **{'PASS' if res['passed'] else 'FAIL'}**, "
                f"{res['n_failures']} outside tolerance.",
                f"- Largest gap: {az:.5f} deg in azimuth (scaled by cos elevation), {el:.5f} deg in elevation.",
                f"- Earth parallax between Moon centre and site: up to {res['max_earth_parallax_deg']:.4f} deg "
                f"at the fixtures (geometric ceiling {res['parallax_upper_bound_deg']:.4f} deg). The check "
                "fails if the site vector is not subtracted.",
                "- Full table: section 3."]
    else:
        out.append(PENDING)
    if eph:
        out.append(f"- Ephemeris rows: {eph['rows']} (hourly). Span and ranges: section 2.")
    out += ["", "### B. Long-run sunlight at Connecting Ridge against a published value", "",
            "- Ours: sunlit 91.2 percent of the time (2 m mast, limb rule), computed by the app's engine "
            "(Agent B, `STATUS-B.md`, Sat 14 Nov) from this pipeline's `ephem.bin` and "
            "`horizon/connecting_ridge.json` over the ephemeris span as it was then, 2024 to 2030.",
            "- Published: 92.27 percent at 2 m above ground (Glaeser et al. 2014, Icarus 243, 78-90, "
            "doi:10.1016/j.icarus.2014.08.013), from a 19-year run on a 20 m/pixel LOLA terrain model.",
            "- The two are not the same experiment: **different time span and newer DEM** (ours is "
            "the 5 m PGDA 78 site model inside the 80 m PGDA 90 grid), and our point is the paper's "
            "site as listed in `data-src/sites.yaml`. Agreement to about one percentage point is a "
            "plausibility check, not a numeric validation.", ""]
    out += ["### C. Uncertainty bands", ""]
    rows = [(k, v) for k, v in (hor or {"sites": {}})["sites"].items() if not v.get("sphere")]
    done = [(k, v) for k, v in rows if v.get("sigma_m") is not None]
    if done:
        out += ["| Site | Full band width at the highest horizon point (deg) | Median full width (deg) | Flag |",
                "|---|---:|---:|---|"]
        for k, v in done:
            out.append(f"| {k} | {2 * v['band_half_width_deg_at_peak']:.4f} | "
                       f"{2 * v['band_half_width_deg_median']:.4f} | {'WIDE' if v.get('band_flag') else 'ok'} |")
        none = [k for k, v in rows if v.get("sigma_m") is None]
        out += ["", "Method and limits: section 5." + (f" No band for: {', '.join(none)}." if none else "")]
    else:
        out.append("Pending: no terrain horizon has a band yet (section 5).")
    out += ["", "### D. Data products", "",
            "- JPL Horizons API, https://ssd.jpl.nasa.gov/api/horizons.api (NASA/JPL), observer tables "
            "for the fixtures. Each fixture stores its query URL.",
            "- NASA GSFC PGDA product 90, LOLA south polar DEMs, Barker et al. 2023, Planet. Sci. J. 4, 183, "
            "doi:10.3847/PSJ/acf3e1, https://pgda.gsfc.nasa.gov/products/90.",
            "- NASA GSFC PGDA product 78, LOLA 5 m site DEMs, Barker et al. 2021, Planet. Space Sci. 203, "
            "105119, https://pgda.gsfc.nasa.gov/products/78.",
            "- NASA NAIF SPICE kernels:"]
    if ker:
        out += [f"  - `{k['name']}`, {k['bytes']} bytes, {k['url']}" for k in ker["kernels"]]
    else:
        out.append("  - " + PENDING)
    if hor:
        used = sorted({d["file"] for _, v in rows for d in v.get("dems", [])} |
                      {e["file"] for _, v in rows for e in v.get("err_maps", [])})
        out += ["- Terrain files read in the last run: " + ", ".join(f"`{u}`" for u in used) + "."]
    return out + [""]


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
           "Barker et al. 2023, Planet. Sci. J. 4, 183, doi:10.3847/PSJ/acf3e1 (`LDEM_80S_80MPP_ADJ.TIF`, "
           "`LDEM_60S_240MPP_ADJ.TIF`, and `LDEM_80S_40MPP_ADJ.TIF` when the run used `--fine 40`).",
           "- NASA GSFC PGDA product 78, https://pgda.gsfc.nasa.gov/products/78, "
           "Barker et al. 2021, Planet. Space Sci. 203, 105119 (`Site01_final_adj_5mpp_surf.tif`, "
           "`Site04_final_adj_5mpp_surf.tif`).",
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


def band_section():
    rep = C.read_report("horizons.json") or {"sites": {}}
    rows = [(k, v) for k, v in rep["sites"].items() if not v.get("sphere")]
    out = ["## 5. Uncertainty bands", ""]
    done = [(k, v) for k, v in rows if v.get("sigma_m") is not None]
    if not done:
        return out + ["Status: **pending**. `elev_lo_deg` and `elev_hi_deg` equal `elev_deg` and "
                      "`dem.sigma_m` is null, so no band is claimed. Source to be used: the per-pixel "
                      "height error maps published with each DEM (PGDA 78 `*_toterr.tif`, PGDA 90 "
                      "`*_ERR.TIF`).", ""]
    out += ["Each DEM is published with a per-pixel height error map in metres: `*_toterr.tif` for the "
            "PGDA 78 site DEMs (described on the product page as formally the RMS error) and "
            "`*_ERR.TIF` for PGDA 90 (described as the LDEM surface height error).", "",
            "Method: the horizon is recomputed twice. Upper edge: every terrain cell raised by its "
            "error, observer lowered by the error at the site. Lower edge: the reverse. This is an "
            "envelope built from the published errors, not a stated confidence interval.", "",
            "Not included: the error from the grid spacing. A grid cannot show relief smaller than "
            "its cells, which matters most where the occluder is only a few cells away. The last "
            "column gives that distance for the highest point of each horizon.", "",
            "`dem.sigma_m` in each horizon file is the median error at the occluder cells.", "",
            "| Site | Error at occluders, median (m) | Error at site (m) | Band half width: median (deg) | "
            "at the peak (deg) | max (deg) | Peak occluder distance (m) | Finest grid (m) |",
            "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for k, v in done:
        res = min(d["used_res_m"] for d in v["dems"])
        out.append(f"| {k} | {v['sigma_m']} | {v['site_sigma_m']} | {v['band_half_width_deg_median']} | "
                   f"{v['band_half_width_deg_at_peak']} | {v['band_half_width_deg_max']} | "
                   f"{v['peak_occluder_dist_m']} | {res:g} |")
    out += ["", "Error maps read: " + "; ".join(sorted({f"`{e['file']}` (median {e['median_m']} m near the site)"
                                                      for _, v in done for e in v["err_maps"]})) + "."]
    missing = [k for k, v in rows if v.get("sigma_m") is None]
    if missing:
        out += ["", "No band (no error map could be read): " + ", ".join(missing) + "."]
    return out + [""]


STATIC_TAIL = """## 6. Feature names

`features.json` is built from `data-src/features-seed.yaml` (IAU names with USGS Gazetteer
IDs, curated by Agent C) plus two informal summits, "Connecting Ridge" and "Peak near
Shackleton", each placed at the highest pixel of its PGDA 78 site DEM. An occluder gets a
feature's id when it lies within 1.1 times the feature's radius of the feature's centre
(the margin lets a crater rim carry the crater's name). When several features contain it,
the smallest wins. A feature that contains the site itself is skipped: at a site on Mons
Mouton nearly every direction would otherwise read "Mons Mouton", which names the ground
underfoot, not an obstacle. Those ids are listed in `site_used.stands_on`. Occluders outside
every remaining feature stay null and must be shown as unnamed terrain. A name says which mapped feature the blocking terrain belongs to, not which part
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
             "reviewed by the human team. Sections 1 to 5 are filled from pipeline/reports/*.json. -->", "",
             "Pipeline commit that produced each report: " + ", ".join(
                 f"{n} `{((C.read_report(n + '.json') or {}).get('meta') or {}).get('git_sha', 'not run')[:7]}`"
                 for n in ("kernels", "ephem", "fixtures", "residuals", "horizons")), "",
             "Conventions: body-fixed frame MOON_ME, east longitude 0 to 360, azimuth clockwise "
             "from north, elevation above the plane normal to the 1737.4 km reference sphere "
             "at the site, UTC.", ""]
    for section in (validation_report, kernels_section, ephem_section, residual_section, horizon_section, band_section):
        lines += section()
    C.DOCS.mkdir(exist_ok=True)
    (C.DOCS / "science.md").write_text("\n".join(lines) + "\n" + STATIC_TAIL, encoding="utf-8")
    print("wrote docs/science.md")


if __name__ == "__main__":
    main()
