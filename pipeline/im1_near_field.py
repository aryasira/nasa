# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Is the terrain that blocks the Sun near azimuth 60 to 80 deg at IM-1 real, or a grid artifact?

The IM-1 cause lines keep naming terrain a few hundred metres away in that sector. This script
rebuilds the IM-1 horizon in several ways and reports whether that blocker stays:
  resolution  80 m grid only, against the finer grid inside it (40 m or 20 m, --fine)
  position    site moved by one fine cell and by one 80 m cell, north, east, south, west
  mast        observer 1 m and 3 m above the ground as well as 2 m
For every variant it also recomputes the lead numbers (sunlit hours of the 7-day stay from
2024-01-19T23:24Z and of the same stay 10 days later) with the reference engine, to show whether
the IM-1 story depends on this blocker.

Needs the DEMs (same files as make_horizons.py). Writes pipeline/reports/im1_near_field.json.

  python pipeline/im1_near_field.py --fine 40
"""
import argparse
import math
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import common as C                      # noqa: E402
import make_horizons as MH              # noqa: E402

sys.path.insert(0, str(C.ROOT / "tests" / "reference"))

SITE_ID = "im1"
SECTOR = (60.0, 80.0)                   # azimuth range of the blocker, degrees
BASE_UTC, STAY_DAYS, SLIP_DAYS = "2024-01-19T23:24:00Z", 7, 10
# The blocker "stays" in a variant when the mean horizon over the sector moves by less than
# this, and the occluder is still closer than NEAR_M.
TOL_DEG, NEAR_M = 1.0, 1000.0


def moved(site, north_m, east_m):
    lat = site["lat"] + math.degrees(north_m / (C.MOON_R_KM * 1000.0))
    lon = site["lon_e"] + math.degrees(east_m / (C.MOON_R_KM * 1000.0 * math.cos(math.radians(site["lat"]))))
    return lat, lon % 360.0


def sector_stats(h):
    az = np.arange(720) * 0.5
    m = (az >= SECTOR[0]) & (az <= SECTOR[1])
    e, d = h["elev_deg"][m], h["occ_dist_m"][m]
    return {"sector_mean_deg": round(float(e.mean()), 3), "sector_min_deg": round(float(e.min()), 3),
            "sector_max_deg": round(float(e.max()), 3),
            "elev_at_az69_deg": round(float(h["elev_deg"][138]), 3),
            "elev_at_az70_deg": round(float(h["elev_deg"][140]), 3),
            "occluder_dist_m_median": None if not np.isfinite(d).any() else round(float(np.nanmedian(d)), 0),
            "horizon_max_deg": round(float(h["elev_deg"].max()), 3)}


def lead_hours(elev_deg):
    """Sunlit hours of the baseline stay and of the slipped stay, reference engine, real data."""
    try:
        from engine_ref import Engine
        eng = Engine(C.DATA)
        eng._hz[SITE_ID] = {"elev_deg": [float(v) for v in elev_deg]}
        t1 = C.iso_z(C.parse_utc(BASE_UTC) + C.datetime.timedelta(days=SLIP_DAYS))
        return {"baseline_sunlit_h": round(eng.window_metrics(SITE_ID, BASE_UTC, STAY_DAYS)["sunlit_h"], 1),
                "slipped_sunlit_h": round(eng.window_metrics(SITE_ID, t1, STAY_DAYS)["sunlit_h"], 1)}
    except Exception as err:            # no real ephem.bin here: keep the terrain result
        return {"baseline_sunlit_h": None, "slipped_sunlit_h": None, "note": f"{type(err).__name__}: {err}"}


def run(site, dirs, fine, horizon_fn=None):
    from horizon_lib import horizon as real_horizon
    horizon_fn = horizon_fn or real_horizon
    coarse = list(MH.PLAN[SITE_ID])
    full = sorted(coarse + ([MH.FINE[fine]] if fine else []), key=lambda n: MH.DEMS[n]["res_m"])
    fine_res = MH.DEMS[full[0]]["res_m"]

    def build(names, lat, lon, mast):
        paths = [MH.find_dem(n, dirs) for n in names]
        radii = [MH.DEMS[n].get("radius_km") for n in names]
        return horizon_fn(lat, lon, paths, mast_m=mast, max_range_km=MH.MAX_RANGE_KM, dem_radius_km=radii)

    variants = [("base", f"finest grid {fine_res:g} m, catalogue point, 2 m mast", full, 0, 0, 2.0)]
    if fine:
        variants.append(("grid_80m", "80 m grid only (the first run's terrain)", coarse, 0, 0, 2.0))
    for step in sorted({float(fine_res), 80.0}):
        for name, dn, de in (("north", step, 0), ("east", 0, step), ("south", -step, 0), ("west", 0, -step)):
            variants.append((f"moved_{step:g}m_{name}", f"site moved {step:g} m {name}", full, dn, de, 2.0))
    for mast in (1.0, 3.0):
        variants.append((f"mast_{mast:g}m", f"observer {mast:g} m above the ground", full, 0, 0, mast))

    rows, base = [], None
    for key, text, names, dn, de, mast in variants:
        lat, lon = moved(site, dn, de)
        h = build(names, lat, lon, mast)
        row = {"variant": key, "what": text, "lat": round(lat, 6), "lon_e": round(lon, 6), "mast_m": mast,
               "site_height_m": round(float(h["site_height_m"]), 1), **sector_stats(h), **lead_hours(h["elev_deg"])}
        if key == "base":
            base = row
        d = abs(row["sector_mean_deg"] - base["sector_mean_deg"])
        near = row["occluder_dist_m_median"] is not None and row["occluder_dist_m_median"] < NEAR_M
        row["blocker_stays"] = bool(d < TOL_DEG and near)
        rows.append(row)
        print(f"{key:18s} sector mean {row['sector_mean_deg']:6.2f} deg (min {row['sector_min_deg']:.2f}, max "
              f"{row['sector_max_deg']:.2f}), occluder ~{row['occluder_dist_m_median']} m, stay "
              f"{row['baseline_sunlit_h']} h -> {row['slipped_sunlit_h']} h, stays: {row['blocker_stays']}")
    hours = [(r["baseline_sunlit_h"], r["slipped_sunlit_h"]) for r in rows if r["baseline_sunlit_h"] is not None]
    survives = all(r["blocker_stays"] for r in rows)
    return {
        "site_id": SITE_ID, "sector_az_deg": list(SECTOR), "finest_grid_m": fine_res,
        "rule": (f"The blocker stays in a variant when the mean horizon over azimuth {SECTOR[0]:g} to "
                 f"{SECTOR[1]:g} deg differs from the base by less than {TOL_DEG:g} deg and the occluder "
                 f"is closer than {NEAR_M:g} m."),
        "variants": rows, "blocker_survives_all": survives,
        "verdict": ("stays: real terrain at this scale; the page may call it nearby terrain" if survives else
                    "does not stay in every variant: call it nearby terrain, low confidence, or drop the line"),
        "position_uncertainty_note": ("No published landing-position uncertainty was used. The moves are one "
                                      "cell of the finest grid and one cell of the 80 m grid."),
        "lead_story": None if not hours else {
            "scenario": f"{STAY_DAYS}-day stay from {BASE_UTC}, and the same stay {SLIP_DAYS} days later",
            "baseline_sunlit_h_range": [min(h[0] for h in hours), max(h[0] for h in hours)],
            "slipped_sunlit_h_range": [min(h[1] for h in hours), max(h[1] for h in hours)],
            "smallest_loss_h": round(min(h[0] - h[1] for h in hours), 1),
            "largest_loss_h": round(max(h[0] - h[1] for h in hours), 1)},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dem-dir", action="append", default=[])
    ap.add_argument("--fine", choices=sorted(MH.FINE))
    args = ap.parse_args()
    site = next(s for s in C.load_sites() if s["id"] == SITE_ID)
    rep = run(site, [pathlib.Path(d) for d in args.dem_dir], args.fine)
    C.write_json(C.REPORTS / "im1_near_field.json", rep, indent=1, generated_by="pipeline/im1_near_field.py")
    print("verdict:", rep["verdict"])
    if rep["lead_story"]:
        print("lead story across all variants:", rep["lead_story"])


if __name__ == "__main__":
    main()
