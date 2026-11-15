# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Build app/public/data/validation.json: the validation scorecard the page's trust badges read.

Every number is computed here from the pipeline's own outputs. Nothing is typed in, except the
published benchmark value, which is quoted with its source.

Parts:
  horizons_check  Sun and Earth directions against NASA JPL Horizons (reports/residuals.json)
  benchmark       long-run sunlight at Connecting Ridge against Glaeser et al. 2014
  lead_lines      sunlit hours of the lead stays with their range across the terrain band
  bands           uncertainty band widths per terrain site (reports/horizons.json)
  im1_near_field  the IM-1 blocker study (reports/im1_near_field.json), when it has been run
  products        kernels and terrain files used

The window numbers come from the Python reference engine (tests/reference/engine_ref.py) on the
real data, the same engine the app is tested against.

  python pipeline/make_validation.py
"""
import json
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import common as C                      # noqa: E402

sys.path.insert(0, str(C.ROOT / "tests" / "reference"))

SUN_RADIUS_1AU_DEG = 0.2666             # same constant as the app engine and the reference engine
BENCH_SITE = "connecting_ridge"
PUBLISHED = {"pct": 92.27, "height_above_ground_m": 2,
             "source": "Glaeser et al. 2014, Icarus 243, 78-90, doi:10.1016/j.icarus.2014.08.013",
             "method": "19-year run on a 20 m/pixel LOLA terrain model"}
# (site, baseline UTC, stay days, slip days): the scenarios quoted on the page.
LEADS = [("im1", "2024-01-19T23:24:00Z", 7, 10), ("im2", "2025-03-06T17:29:00Z", 10, 7),
         ("connecting_ridge", "2025-03-06T17:30:00Z", 10, 7)]


def honest_one_over(ratio):
    """Largest round denominator not above the true one, so "1/N" never overstates the match."""
    if ratio < 10:
        return int(math.floor(ratio))
    step = 10 ** (len(str(int(ratio))) - 2)
    step = step * 5 if ratio / step >= 50 else step
    return int(math.floor(ratio / step) * step)


def horizons_part():
    res, fx = C.read_report("residuals.json"), json.loads((C.DATA / "fixtures.json").read_text())
    eph = C.read_report("ephem.json")
    rows = fx["fixtures"]
    az = max(r["max_az_gap_deg"] for r in res["rows"])
    el = max(r["max_el_gap_deg"] for r in res["rows"])
    worst = max(az, el)
    d_min, d_max = (2 * SUN_RADIUS_1AU_DEG / eph["sun_au"][1], 2 * SUN_RADIUS_1AU_DEG / eph["sun_au"][0])
    return {
        "source": "NASA JPL Horizons API, apparent airless azimuth and elevation for an observer on the lunar surface",
        "n_fixtures": len(rows), "n_epochs": len({r["utc"] for r in rows}),
        "n_sites": len({r["site_id"] for r in rows}), "site_ids": sorted({r["site_id"] for r in rows}),
        "bodies": sorted({r["body"] for r in rows}),
        "tol_deg": res["tol_deg"], "passed": bool(res["passed"]), "n_failures": res["n_failures"],
        "max_az_gap_deg": az, "max_el_gap_deg": el,
        "max_earth_parallax_deg": res["max_earth_parallax_deg"],
        "sun_diameter_deg": [round(d_min, 4), round(d_max, 4)],
        "max_gap_as_fraction_of_sun_diameter": {
            "one_over": honest_one_over(d_min / worst), "exact_ratio": round(d_min / worst, 1),
            "text": f"about 1/{honest_one_over(d_min / worst)} of the Sun's width"},
        "run_git_sha": (res.get("meta") or {}).get("git_sha"),
        "fixtures_git_sha": (fx.get("meta") or {}).get("git_sha"),
    }


def bench_part(eng):
    t0, t1 = eng.ephem.t0, eng.ephem.t0 + eng.ephem.step_s * (eng.ephem.n - 1)
    from engine_ref import fmt_utc
    a, b = fmt_utc(t0), fmt_utc(t1)

    def share(mode, key="elev_deg"):
        m = eng.window_metrics(BENCH_SITE, a, end_utc=b, mode=mode, horizon_key=key, step_s=3600)
        return round(100.0 * m["sunlit_h"] / ((t1 - t0) / 3600.0), 2)

    return {
        "site_id": BENCH_SITE, "span_utc": [a, b], "years": round((t1 - t0) / (365.25 * 86400), 2),
        "step_s": 3600, "mast_m": 2,
        "ours_limb_pct": share("limb"),
        "ours_limb_band_pct": sorted([share("limb", "elev_lo_deg"), share("limb", "elev_hi_deg")]),
        "ours_centre_pct": share("centre"),
        "published": PUBLISHED,
        "published_inside_our_band": None,     # filled below
        "differences": ("Different time span and newer DEM: ours is the 5 m PGDA 78 site model inside the "
                        "80 m PGDA 90 grid over the ephemeris span; the paper used a 20 m/pixel model over "
                        "19 years. A plausibility check, not a numeric validation."),
    }


def lead_part(eng):
    from engine_ref import fmt_utc, parse_utc
    out = []
    for site, utc, stay, slip in LEADS:
        if site not in eng.sites or not (C.DATA / "horizon" / f"{site}.json").exists():
            continue
        name = eng.sites[site]["name"]
        for label, start in (("baseline", utc), (f"+{slip} d", fmt_utc(parse_utc(utc) + slip * 86400.0))):
            m = eng.window_metrics_with_band(site, start, stay)
            rng = lambda k: sorted([round(m["band"]["lo"][k], 1), round(m["band"]["hi"][k], 1)])  # noqa: E731
            s, r = round(m["sunlit_h"], 1), rng("sunlit_h")
            out.append({
                "site_id": site, "which": label, "start_utc": m["start_utc"], "stay_days": stay,
                "sunlit_h": s, "sunlit_h_range": r,
                "both_visible_h": round(m["both_visible_h"], 1), "both_visible_h_range": rng("both_visible_h"),
                "text": (f"sunlit hours for the {stay}-day {name} stay from {m['start_utc'][:16].replace('T', ' ')} UTC "
                         f"({label}): {s} h, range {r[0]} to {r[1]} h across the terrain error band"),
            })
    return out


def bands_part():
    rep = C.read_report("horizons.json") or {"sites": {}}
    out = {}
    for k, v in rep["sites"].items():
        if v.get("sphere") or v.get("sigma_m") is None:
            continue
        out[k] = {"sigma_m": v["sigma_m"], "site_sigma_m": v["site_sigma_m"],
                  "full_width_at_peak_deg": round(2 * v["band_half_width_deg_at_peak"], 4),
                  "median_full_width_deg": round(2 * v["band_half_width_deg_median"], 4),
                  "max_full_width_deg": round(2 * v["band_half_width_deg_max"], 4),
                  "flag_wide": bool(v.get("band_flag"))}
    return {"method": rep.get("band_method"), "sites": out}


def near_part():
    r = C.read_report("im1_near_field.json")
    if not r:
        return {"status": "not run"}
    return {"status": "run", "blocker_survives_all": r["blocker_survives_all"], "verdict": r["verdict"],
            "finest_grid_m": r["finest_grid_m"], "n_variants": len(r["variants"]), "rule": r["rule"],
            "lead_story": r["lead_story"], "git_sha": (r.get("meta") or {}).get("git_sha")}


def products_part():
    ker, hor = C.read_report("kernels.json") or {"kernels": []}, C.read_report("horizons.json") or {"sites": {}}
    files = sorted({d["file"] for v in hor["sites"].values() if not v.get("sphere") for d in v.get("dems", [])} |
                   {e["file"] for v in hor["sites"].values() if not v.get("sphere") for e in v.get("err_maps", [])})
    return {
        "kernels": [{"name": k["name"], "bytes": k["bytes"], "sha256": k["sha256"], "url": k["url"]}
                    for k in ker["kernels"]],
        "spice": (C.read_report("ephem.json") or {}).get("spice_version"),
        "terrain_files": files,
        "terrain_sources": [
            {"name": "NASA GSFC PGDA product 90, LOLA south polar DEMs",
             "cite": "Barker et al. 2023, Planet. Sci. J. 4, 183, doi:10.3847/PSJ/acf3e1",
             "url": "https://pgda.gsfc.nasa.gov/products/90"},
            {"name": "NASA GSFC PGDA product 78, LOLA 5 m site DEMs",
             "cite": "Barker et al. 2021, Planet. Space Sci. 203, 105119",
             "url": "https://pgda.gsfc.nasa.gov/products/78"}],
        "ephemeris_check": {"name": "NASA JPL Horizons API", "url": "https://ssd.jpl.nasa.gov/api/horizons.api"},
    }


def build():
    from engine_ref import Engine
    eng = Engine(C.DATA)
    bench = bench_part(eng)
    lo, hi = bench["ours_limb_band_pct"]
    bench["published_inside_our_band"] = bool(lo <= PUBLISHED["pct"] <= hi)
    doc = {"schema_version": 1, "horizons_check": horizons_part(), "benchmark": bench,
           "lead_lines": lead_part(eng), "bands": bands_part(), "im1_near_field": near_part(),
           "products": products_part(), "meta": C.meta("pipeline/make_validation.py")}
    doc["meta"]["mock"] = False
    return doc


def main():
    doc = build()
    C.write_json(C.DATA / "validation.json", doc, indent=1)
    h, b = doc["horizons_check"], doc["benchmark"]
    print(f"Horizons: {h['n_fixtures']} fixtures, {h['n_epochs']} epochs, {h['n_sites']} sites, "
          f"max gap az {h['max_az_gap_deg']} el {h['max_el_gap_deg']} deg, "
          f"{h['max_gap_as_fraction_of_sun_diameter']['text']}")
    print(f"Benchmark {b['site_id']}: limb {b['ours_limb_pct']}% (band {b['ours_limb_band_pct']}), "
          f"centre {b['ours_centre_pct']}%, published {b['published']['pct']}%, "
          f"inside band: {b['published_inside_our_band']}")
    for line in doc["lead_lines"]:
        print(" ", line["text"])
    print("IM-1 near field:", doc["im1_near_field"]["status"])
    print("wrote app/public/data/validation.json")


if __name__ == "__main__":
    main()
