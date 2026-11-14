# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Write app/public/data/horizon/<site_id>.json and features.json.

Sites with terrain "lola" get a ray-marched horizon from NASA LOLA DEMs:
720 azimuths, Moon curvature, observer 2 m above the DEM surface, out to
220 km, with the occluder (distance, lat, lon) of every azimuth.
Sites with terrain "sphere" get a flat 0 deg horizon with null occluders.

DEMs (downloaded to pipeline/cache/ if not found in --dem-dir):
  NASA GSFC PGDA product 90, Barker et al. 2023, Planet. Sci. J. 4, 183
    LDEM_80S_80MPP_ADJ.TIF   80 m/pix, 80S to the pole
    LDEM_60S_240MPP_ADJ.TIF  240 m/pix, 60S to the pole
  NASA GSFC PGDA product 78, Barker et al. 2021, Planet. Space Sci. 203, 105119
    Site01_final_adj_5mpp_surf.tif  5 m/pix, Connecting Ridge

Usage:
  python pipeline/make_horizons.py
  python pipeline/make_horizons.py --dem-dir "C:\\path\\to\\existing\\dems"
  python pipeline/make_horizons.py --only im1
"""
import argparse
import os
import pathlib
import time

import numpy as np

import common as C

P90 = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
P78 = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/"
DEMS = {
    "LDEM_80S_80MPP_ADJ.TIF": {"url": P90 + "LDEM_80S_80MPP_ADJ.TIF", "res_m": 80,
                               "product": "NASA GSFC PGDA 90 LDEM_80S_80MPP_ADJ"},
    "LDEM_60S_240MPP_ADJ.TIF": {"url": P90 + "LDEM_60S_240MPP_ADJ.TIF", "res_m": 240,
                                "product": "NASA GSFC PGDA 90 LDEM_60S_240MPP_ADJ"},
    "Site01_final_adj_5mpp_surf.tif": {"url": P78 + "Site01/Site01_final_adj_5mpp_surf.tif",
                                       "res_m": 5, "product": "NASA GSFC PGDA 78 Site01 5 m"},
}
# Finest first. The first DEM with data at a ray sample wins.
PLAN = {
    "im1": ["LDEM_80S_80MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.TIF"],
    "im2": ["LDEM_80S_80MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.TIF"],
    "chandrayaan3": ["LDEM_60S_240MPP_ADJ.TIF"],
    "connecting_ridge": ["Site01_final_adj_5mpp_surf.tif", "LDEM_80S_80MPP_ADJ.TIF"],
}
# data-src/sites.yaml holds a placeholder for this site (TODO(A)). Until
# Agent C updates it, the horizon is computed at the point below and the
# point is written into the output as site_used. See STATUS-A.md.
OVERRIDE = {
    "connecting_ridge": {"lat": -89.438909, "lon_e": 222.85643,
                         "why": "highest pixel of the PGDA 78 Site01 5 m DEM"},
}
MAST_M = 2.0
MAX_RANGE_KM = 220.0
PGDA78 = {"org": "NASA GSFC PGDA product 78 (point = highest pixel of the site DEM, "
                 "computed by pipeline/horizon_lib.py)",
          "url": "https://pgda.gsfc.nasa.gov/products/78"}
# Informal names only. IAU names with Gazetteer IDs are added in a later pass.
FEATURES = [
    ("connecting_ridge_peak", "Connecting Ridge", "ridge", -89.438909, 222.85643),
    ("shackleton_rim_peak", "Shackleton rim", "rim", -89.780403, 203.803049),
    ("peak_near_shackleton", "Peak near Shackleton", "massif", -88.80815, 123.717548),
    ("de_gerlache_rim_peak", "de Gerlache rim", "rim", -88.663939, 291.611678),
    ("leibnitz_beta_plateau", "Leibnitz beta plateau", "massif", -85.404619, 31.707317),
    ("malapert_massif_peak", "Malapert massif", "massif", -85.987678, 2.068132),
]
FEATURE_RADIUS_KM = 4.0


def features_doc():
    return {"schema_version": 1, "meta": C.meta("pipeline/make_horizons.py"), "features": [
        {"id": fid, "name": name, "name_status": "informal", "gazetteer_id": None,
         "type": kind, "lat": lat, "lon_e": lon, "radius_km": FEATURE_RADIUS_KM,
         "source": PGDA78} for fid, name, kind, lat, lon in FEATURES]}


def match_features(lat, lon):
    """Feature id for each occluder cell, or None. Great-circle distance."""
    out = [None] * len(lat)
    ok = np.isfinite(lat)
    if not ok.any():
        return out
    la, lo = np.radians(lat[ok]), np.radians(lon[ok])
    best = np.full(ok.sum(), np.inf)
    best_id = np.full(ok.sum(), -1)
    for k, (_, _, _, flat, flon) in enumerate(FEATURES):
        fa, fo = np.radians(flat), np.radians(flon)
        cosd = np.sin(la) * np.sin(fa) + np.cos(la) * np.cos(fa) * np.cos(lo - fo)
        d = C.MOON_R_KM * np.arccos(np.clip(cosd, -1, 1))
        closer = d < best
        best[closer], best_id[closer] = d[closer], k
    for j, i in enumerate(np.flatnonzero(ok)):
        if best[j] <= FEATURE_RADIUS_KM:
            out[i] = FEATURES[best_id[j]][0]
    return out


def find_dem(name, dirs):
    for d in dirs:
        p = pathlib.Path(d) / name
        if p.exists() and p.stat().st_size > 0:
            return p
    dest = C.CACHE / name
    C.fetch(DEMS[name]["url"], dest)
    return dest


def nullable(arr, digits):
    return [None if not np.isfinite(v) else round(float(v), digits) for v in arr]


def sphere_doc(site):
    zeros = [0.0] * 720
    return {"schema_version": 1, "site_id": site["id"], "mast_m": MAST_M, "az_step_deg": 0.5,
            "elev_deg": zeros, "elev_lo_deg": zeros, "elev_hi_deg": zeros,
            "occluder": {"dist_m": [None] * 720, "lat": [None] * 720,
                         "lon_e": [None] * 720, "feature_id": [None] * 720},
            "dem": {"product": "sphere", "res_m": None, "sigma_m": None, "max_range_km": None},
            "meta": C.meta("pipeline/make_horizons.py")}


def lola_doc(site, dirs):
    from horizon_lib import horizon     # needs rasterio, pyproj, scipy

    names = PLAN[site["id"]]
    paths = [find_dem(n, dirs) for n in names]
    point = OVERRIDE.get(site["id"], {"lat": site["lat"], "lon_e": site["lon_e"]})
    t = time.time()
    h = horizon(point["lat"], point["lon_e"], paths, mast_m=MAST_M,
                max_range_km=MAX_RANGE_KM, sigma_m=None)
    feature_id = match_features(h["occ_lat"], h["occ_lon_e"])
    used = [d["file"] for d in h["dems"]]
    doc = {
        "schema_version": 1, "site_id": site["id"], "mast_m": MAST_M, "az_step_deg": 0.5,
        "elev_deg": [round(float(v), 4) for v in h["elev_deg"]],
        "elev_lo_deg": [round(float(v), 4) for v in h["elev_lo_deg"]],
        "elev_hi_deg": [round(float(v), 4) for v in h["elev_hi_deg"]],
        "occluder": {"dist_m": nullable(h["occ_dist_m"], 0), "lat": nullable(h["occ_lat"], 5),
                     "lon_e": nullable(h["occ_lon_e"], 5), "feature_id": feature_id},
        "dem": {"product": " + ".join(DEMS[n]["product"] for n in used),
                "res_m": min(DEMS[n]["res_m"] for n in used),
                "sigma_m": None, "max_range_km": MAX_RANGE_KM, "layers": used},
        "site_used": {"lat": point["lat"], "lon_e": point["lon_e"],
                      "elev_dem_m": round(h["site_height_m"], 2),
                      "elev_dem_from": h["site_height_from"],
                      "elev_catalog_m": site.get("elev_m"),
                      "differs_from_catalog": site["id"] in OVERRIDE},
        "meta": C.meta("pipeline/make_horizons.py"),
    }
    e = h["elev_deg"]
    report = {
        "site_id": site["id"], "site_used": doc["site_used"], "dems": h["dems"],
        "skipped": h["skipped"], "elev_min_deg": round(float(e.min()), 3),
        "elev_max_deg": round(float(e.max()), 3),
        "elev_max_at_az_deg": float(h["az_deg"][int(e.argmax())]),
        "null_occluder_share": round(float(np.mean(~np.isfinite(h["occ_dist_m"]))), 3),
        "named_share": round(sum(f is not None for f in feature_id) / 720.0, 3),
        "coverage_min_km": round(float(h["coverage_km"].min()), 1),
        "occluder_dist_km_median": (None if not np.isfinite(h["occ_dist_m"]).any()
                                    else round(float(np.nanmedian(h["occ_dist_m"])) / 1000, 2)),
        "seconds": round(time.time() - t, 1),
    }
    return doc, report


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dem-dir", action="append", default=[],
                    help="folder that already holds the DEM files; repeatable")
    ap.add_argument("--only", action="append", default=[], help="site id; repeatable")
    args = ap.parse_args()
    dirs = args.dem_dir + ([os.environ["LOLA_DEM_DIR"]] if os.environ.get("LOLA_DEM_DIR") else []) + [C.CACHE]

    C.write_json(C.DATA / "features.json", features_doc(), indent=1)
    reports = (C.read_report("horizons.json") or {"sites": {}})["sites"]
    failed = []
    for site in C.load_sites():
        if args.only and site["id"] not in args.only:
            continue
        out = C.DATA / "horizon" / f"{site['id']}.json"
        if site["terrain"] == "lola":
            try:
                doc, rep = lola_doc(site, dirs)
            except Exception as err:                # keep going with other sites
                failed.append(f"{site['id']}: {type(err).__name__}: {err}")
                print(f"FAILED {failed[-1]}")
                continue
            reports[site["id"]] = rep
            print(f"{site['id']:17s} elev {rep['elev_min_deg']:6.2f}..{rep['elev_max_deg']:5.2f} deg, "
                  f"peak at az {rep['elev_max_at_az_deg']:5.1f}, site {rep['site_used']['elev_dem_m']:8.1f} m "
                  f"(catalogue {rep['site_used']['elev_catalog_m']}), null occluders "
                  f"{rep['null_occluder_share'] * 100:3.0f}%, named {rep['named_share'] * 100:3.0f}%, "
                  f"coverage min {rep['coverage_min_km']:6.1f} km, {rep['seconds']} s")
        else:
            doc = sphere_doc(site)
            reports[site["id"]] = {"site_id": site["id"], "sphere": True}
            print(f"{site['id']:17s} sphere: flat 0 deg horizon, null occluders")
        C.write_json(out, doc)
    C.write_json(C.REPORTS / "horizons.json", {"sites": reports, "mast_m": MAST_M,
                 "max_range_km": MAX_RANGE_KM, "sigma_note": "pending: lo = hi = elev"}, indent=1)
    if failed:
        raise SystemExit("SOME HORIZONS FAILED:\n" + "\n".join(failed))
    print("horizons written to app/public/data/horizon/")


if __name__ == "__main__":
    main()
