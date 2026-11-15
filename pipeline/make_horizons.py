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
    Site04_final_adj_5mpp_surf.tif  5 m/pix, Shackleton rim
Each DEM's published per-pixel height error map (*_ERR.TIF, *_toterr.tif) is
downloaded too and gives the uncertainty band (elev_lo_deg, elev_hi_deg).

Optional finer near field for im1 and im2 (large downloads, same product 90):
  --fine 40   LDEM_80S_40MPP_ADJ.TIF (685M) + _ERR (964M), used within 100 km
  --fine 20   LDEM_80S_20MPP_ADJ.TIF (2.6G) + _ERR (3.7G), used within 55 km

Usage:
  python pipeline/make_horizons.py
  python pipeline/make_horizons.py --dem-dir "C:\\path\\to\\existing\\dems"
  python pipeline/make_horizons.py --only im1
  python pipeline/make_horizons.py --only im1 --only im2 --fine 40
  python pipeline/make_horizons.py --no-bands
"""
import argparse
import os
import pathlib
import time

import numpy as np

import common as C

P90 = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
P78 = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/"
# File names and sizes as listed on the two PGDA product pages (read 14 Nov 2026).
# "err" is the per-pixel height error map published with each DEM, in metres.
DEMS = {
    "LDEM_80S_80MPP_ADJ.TIF": {"url": P90 + "LDEM_80S_80MPP_ADJ.TIF", "res_m": 80,
                               "product": "NASA GSFC PGDA 90 LDEM_80S_80MPP_ADJ",
                               "err": "LDEM_80S_80MPP_ADJ_ERR.TIF"},
    "LDEM_60S_240MPP_ADJ.TIF": {"url": P90 + "LDEM_60S_240MPP_ADJ.TIF", "res_m": 240,
                                "product": "NASA GSFC PGDA 90 LDEM_60S_240MPP_ADJ",
                                "err": "LDEM_60S_240MPP_ADJ_ERR.TIF"},
    "Site01_final_adj_5mpp_surf.tif": {"url": P78 + "Site01/Site01_final_adj_5mpp_surf.tif",
                                       "res_m": 5, "product": "NASA GSFC PGDA 78 Site01 5 m",
                                       "err": "Site01_final_adj_5mpp_toterr.tif"},
    "Site04_final_adj_5mpp_surf.tif": {"url": P78 + "Site04/Site04_final_adj_5mpp_surf.tif",
                                       "res_m": 5, "product": "NASA GSFC PGDA 78 Site04 5 m",
                                       "err": "Site04_final_adj_5mpp_toterr.tif"},
    "LDEM_80S_40MPP_ADJ.TIF": {"url": P90 + "LDEM_80S_40MPP_ADJ.TIF", "res_m": 40,
                               "product": "NASA GSFC PGDA 90 LDEM_80S_40MPP_ADJ",
                               "err": "LDEM_80S_40MPP_ADJ_ERR.TIF", "radius_km": 100.0},
    "LDEM_80S_20MPP_ADJ.TIF": {"url": P90 + "LDEM_80S_20MPP_ADJ.TIF", "res_m": 20,
                               "product": "NASA GSFC PGDA 90 LDEM_80S_20MPP_ADJ",
                               "err": "LDEM_80S_20MPP_ADJ_ERR.TIF", "radius_km": 55.0},
}
ERR_URL = {
    "LDEM_80S_80MPP_ADJ_ERR.TIF": P90 + "LDEM_80S_80MPP_ADJ_ERR.TIF",
    "LDEM_60S_240MPP_ADJ_ERR.TIF": P90 + "LDEM_60S_240MPP_ADJ_ERR.TIF",
    "LDEM_80S_40MPP_ADJ_ERR.TIF": P90 + "LDEM_80S_40MPP_ADJ_ERR.TIF",
    "LDEM_80S_20MPP_ADJ_ERR.TIF": P90 + "LDEM_80S_20MPP_ADJ_ERR.TIF",
    "Site01_final_adj_5mpp_toterr.tif": P78 + "Site01/Site01_final_adj_5mpp_toterr.tif",
    "Site04_final_adj_5mpp_toterr.tif": P78 + "Site04/Site04_final_adj_5mpp_toterr.tif",
}
# Sites inside the 80S grids that can take a finer near-field layer (--fine).
# connecting_ridge is left as it was so the published-benchmark number does not move.
FINE_SITES = {"im1", "im2", "shackleton_sr1", "shackleton_sr2"}
FINE = {"40": "LDEM_80S_40MPP_ADJ.TIF", "20": "LDEM_80S_20MPP_ADJ.TIF"}
BAND_METHOD = ("envelope: terrain raised by its published per-pixel height error and the "
               "observer lowered by the error at the site (upper edge), and the reverse "
               "(lower edge). Grid-spacing error is not included.")
# Finest first. The first DEM with data at a ray sample wins.
PLAN = {
    "im1": ["LDEM_80S_80MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.TIF"],
    "im2": ["LDEM_80S_80MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.TIF"],
    "chandrayaan3": ["LDEM_60S_240MPP_ADJ.TIF"],
    "connecting_ridge": ["Site01_final_adj_5mpp_surf.tif", "LDEM_80S_80MPP_ADJ.TIF"],
    "shackleton_sr1": ["Site04_final_adj_5mpp_surf.tif", "LDEM_80S_80MPP_ADJ.TIF"],
    "shackleton_sr2": ["Site04_final_adj_5mpp_surf.tif", "LDEM_80S_80MPP_ADJ.TIF"],
}
# Round-2 sites. Agent C adds them to data-src/sites.yaml with their source
# (Glaeser et al. 2014). Until they are in sites.json the coordinates below,
# copied from docs/agents/ROUND2-A.md, are used. The catalogue wins when it has the id.
# de_gerlache_rim is not here: no published point with coordinates was found.
ROUND2_SITES = [
    {"id": "shackleton_sr1", "lat": -89.7742, "lon_e": 203.4952, "elev_m": None, "terrain": "lola"},
    {"id": "shackleton_sr2", "lat": -89.6871, "lon_e": 197.0983, "elev_m": None, "terrain": "lola"},
]
# A band wider than this at the highest point of the horizon is flagged.
BAND_FLAG_DEG = 0.5
# Set a point here only if the catalogue must be overridden; the point is
# then written into the output as site_used.differs_from_catalog = true.
OVERRIDE = {}
MAST_M = 2.0
MAX_RANGE_KM = 220.0
PGDA78 = {"org": "NASA GSFC PGDA product 78 (point = highest pixel of the site DEM, "
                 "computed by pipeline/horizon_lib.py)",
          "url": "https://pgda.gsfc.nasa.gov/products/78"}
# Informal names for two summits no IAU feature covers. Everything else comes
# from data-src/features-seed.yaml (IAU names with Gazetteer IDs, owner C).
INFORMAL = [
    {"id": "connecting_ridge_summit", "name": "Connecting Ridge", "type": "ridge",
     "lat": -89.438909, "lon_e": 222.85643, "radius_km": 4.0},
    {"id": "peak_near_shackleton", "name": "Peak near Shackleton", "type": "massif",
     "lat": -88.80815, "lon_e": 123.717548, "radius_km": 4.0},
]
# An occluder matches a feature when it lies within RADIUS_MARGIN x radius_km
# of the feature centre. The margin lets a crater's raised rim, which sits at
# about one radius, carry the crater's name.
RADIUS_MARGIN = 1.1
SEED = C.ROOT / "data-src" / "features-seed.yaml"


def load_features():
    """IAU features from Agent C's seed file plus the informal summits."""
    feats = []
    if SEED.exists():
        import yaml
        seed = yaml.safe_load(SEED.read_text(encoding="utf-8"))
        org = seed.get("source", {}).get("org", "USGS Gazetteer of Planetary Nomenclature")
        for f in seed["features"]:
            gid = f.get("gazetteer_id")
            if f.get("name_status") == "iau" and not gid:
                raise SystemExit(f"feature {f['id']}: name_status iau needs a gazetteer_id")
            feats.append({"id": f["id"], "name": f["name"], "name_status": f["name_status"],
                          "gazetteer_id": gid, "type": f.get("type", ""),
                          "lat": f["lat"], "lon_e": f["lon_e"], "radius_km": f.get("radius_km"),
                          "source": {"org": org, "url": f"https://planetarynames.wr.usgs.gov/Feature/{gid}"}})
    for f in INFORMAL:
        feats.append(dict(f, name_status="informal", gazetteer_id=None, source=PGDA78))
    return feats


def features_doc(feats=None):
    return {"schema_version": 1, "meta": C.meta("pipeline/make_horizons.py"),
            "features": load_features() if feats is None else feats}


def match_features(lat, lon, feats):
    """Feature id for each occluder cell, or None.

    A cell matches every feature whose centre is within RADIUS_MARGIN x
    radius_km (great-circle). Of those, the smallest feature wins, so a
    summit inside a large mons keeps its own name."""
    out = [None] * len(lat)
    ok = np.isfinite(lat)
    usable = [f for f in feats if f.get("radius_km")]
    if not ok.any() or not usable:
        return out
    la, lo = np.radians(lat[ok]), np.radians(lon[ok])
    best_r = np.full(ok.sum(), np.inf)
    best_k = np.full(ok.sum(), -1)
    for k, f in enumerate(usable):
        fa, fo = np.radians(f["lat"]), np.radians(f["lon_e"])
        cosd = np.sin(la) * np.sin(fa) + np.cos(la) * np.cos(fa) * np.cos(lo - fo)
        d = C.MOON_R_KM * np.arccos(np.clip(cosd, -1, 1))
        hit = (d <= RADIUS_MARGIN * f["radius_km"]) & (f["radius_km"] < best_r)
        best_r[hit], best_k[hit] = f["radius_km"], k
    for j, i in enumerate(np.flatnonzero(ok)):
        if best_k[j] >= 0:
            out[i] = usable[best_k[j]]["id"]
    return out


def find_dem(name, dirs):
    for d in dirs:
        p = pathlib.Path(d) / name
        if p.exists() and p.stat().st_size > 0:
            return p
    dest = C.CACHE / name
    C.fetch(DEMS[name]["url"] if name in DEMS else ERR_URL[name], dest)
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


def lola_doc(site, dirs, feats, fine=None, bands=True):
    from horizon_lib import horizon     # needs rasterio, pyproj, scipy

    names = list(PLAN[site["id"]])
    if fine and site["id"] in FINE_SITES:
        names.insert(0, FINE[fine])
    paths = [find_dem(n, dirs) for n in names]
    radii = [DEMS[n].get("radius_km") for n in names]
    errs, band_note = None, "off (--no-bands)"
    if bands:
        try:
            errs = [find_dem(DEMS[n]["err"], dirs) for n in names]
            band_note = "ok"
        except Exception as err:        # no error map: no band is claimed
            band_note = f"no band: {type(err).__name__}: {err}"
            print(f"  {site['id']}: {band_note}")
    point = OVERRIDE.get(site["id"], {"lat": site["lat"], "lon_e": site["lon_e"]})
    t = time.time()
    try:
        h = horizon(point["lat"], point["lon_e"], paths, mast_m=MAST_M,
                    max_range_km=MAX_RANGE_KM, err_paths=errs, dem_radius_km=radii)
    except ValueError as err:
        if errs is None:
            raise
        band_note = f"no band: {err}"
        print(f"  {site['id']}: {band_note}")
        errs = None
        h = horizon(point["lat"], point["lon_e"], paths, mast_m=MAST_M,
                    max_range_km=MAX_RANGE_KM, dem_radius_km=radii)
    has_band = errs is not None
    occ_sig = h["occ_sigma_m"]
    sigma = (round(float(np.nanmedian(occ_sig)), 3)
             if has_band and np.isfinite(occ_sig).any() else None)
    half = (h["elev_hi_deg"] - h["elev_lo_deg"]) / 2.0
    feature_id = match_features(h["occ_lat"], h["occ_lon_e"], feats)
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
                "sigma_m": sigma, "max_range_km": MAX_RANGE_KM, "layers": used},
        "site_used": {"lat": point["lat"], "lon_e": point["lon_e"],
                      "elev_dem_m": round(h["site_height_m"], 2),
                      "elev_dem_from": h["site_height_from"],
                      "elev_catalog_m": site.get("elev_m"),
                      "point_from": site.get("_from", "app/public/data/sites.json"),
                      "differs_from_catalog": site["id"] in OVERRIDE},
        "meta": C.meta("pipeline/make_horizons.py"),
    }
    if sigma is not None:
        # dem.sigma_m is the median published height error at the occluder cells.
        doc["band"] = {"method": BAND_METHOD,
                       "site_sigma_m": round(float(h["site_sigma_m"]), 3),
                       "occluder_sigma_m": nullable(occ_sig, 3),
                       "err_maps": h["err_maps"]}
    e = h["elev_deg"]
    report = {
        "site_id": site["id"], "site_used": doc["site_used"], "dems": h["dems"],
        "skipped": h["skipped"], "elev_min_deg": round(float(e.min()), 3),
        "elev_max_deg": round(float(e.max()), 3),
        "elev_max_at_az_deg": float(h["az_deg"][int(e.argmax())]),
        "null_occluder_share": round(float(np.mean(~np.isfinite(h["occ_dist_m"]))), 3),
        "named_share": round(sum(f is not None for f in feature_id) / 720.0, 3),
        "names_seen": sorted({f for f in feature_id if f}),
        "coverage_min_km": round(float(h["coverage_km"].min()), 1),
        "occluder_dist_km_median": (None if not np.isfinite(h["occ_dist_m"]).any()
                                    else round(float(np.nanmedian(h["occ_dist_m"])) / 1000, 2)),
        "band": band_note, "sigma_m": sigma,
        "site_sigma_m": None if sigma is None else round(float(h["site_sigma_m"]), 3),
        "err_maps": h["err_maps"] if sigma is not None else [],
        "band_half_width_deg_median": None if sigma is None else round(float(np.median(half)), 4),
        "band_half_width_deg_max": None if sigma is None else round(float(half.max()), 4),
        "band_half_width_deg_at_peak": None if sigma is None else round(float(half[int(e.argmax())]), 4),
        "peak_occluder_dist_m": (None if not np.isfinite(h["occ_dist_m"][int(e.argmax())])
                                 else round(float(h["occ_dist_m"][int(e.argmax())]), 0)),
        "band_flag": bool(sigma is not None and half[int(e.argmax())] * 2 > BAND_FLAG_DEG),
        "point_from": site.get("_from", "app/public/data/sites.json"),
        "fine": fine if (fine and site["id"] in FINE_SITES) else None,
        "seconds": round(time.time() - t, 1),
    }
    return doc, report


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dem-dir", action="append", default=[],
                    help="folder that already holds the DEM files; repeatable")
    ap.add_argument("--only", action="append", default=[], help="site id; repeatable")
    ap.add_argument("--fine", choices=sorted(FINE), help="finer near-field grid for im1 and im2 (large download)")
    ap.add_argument("--no-bands", action="store_true", help="skip the error maps and the uncertainty band")
    args = ap.parse_args()
    dirs = args.dem_dir + ([os.environ["LOLA_DEM_DIR"]] if os.environ.get("LOLA_DEM_DIR") else []) + [C.CACHE]

    feats = load_features()
    C.write_json(C.DATA / "features.json", features_doc(feats), indent=1)
    print(f"features.json: {len(feats)} features, "
          f"{sum(f['name_status'] == 'iau' for f in feats)} with IAU Gazetteer IDs")
    reports = (C.read_report("horizons.json") or {"sites": {}})["sites"]
    failed = []
    sites = C.load_sites()
    have = {x["id"] for x in sites}
    sites += [dict(x, _from="docs/agents/ROUND2-A.md (not yet in sites.json)")
              for x in ROUND2_SITES if x["id"] not in have]
    for site in sites:
        if args.only and site["id"] not in args.only:
            continue
        out = C.DATA / "horizon" / f"{site['id']}.json"
        if site["terrain"] == "lola" and site["id"] not in PLAN:
            failed.append(f"{site['id']}: terrain is lola but make_horizons.PLAN has no DEM list for it")
            print(f"FAILED {failed[-1]}")
            continue
        if site["terrain"] == "lola":
            try:
                doc, rep = lola_doc(site, dirs, feats, fine=args.fine, bands=not args.no_bands)
            except Exception as err:                # keep going with other sites
                failed.append(f"{site['id']}: {type(err).__name__}: {err}")
                print(f"FAILED {failed[-1]}")
                continue
            reports[site["id"]] = rep
            print(f"{site['id']:17s} elev {rep['elev_min_deg']:6.2f}..{rep['elev_max_deg']:5.2f} deg, "
                  f"peak at az {rep['elev_max_at_az_deg']:5.1f}, site {rep['site_used']['elev_dem_m']:8.1f} m "
                  f"(catalogue {rep['site_used']['elev_catalog_m']}), null occluders "
                  f"{rep['null_occluder_share'] * 100:3.0f}%, named {rep['named_share'] * 100:3.0f}% "
                  f"{rep['names_seen']}, coverage min {rep['coverage_min_km']:6.1f} km, {rep['seconds']} s")
            if rep["sigma_m"] is not None:
                print(f"{'':17s} band: height error {rep['sigma_m']} m at occluders, {rep['site_sigma_m']} m at site; "
                      f"half width median {rep['band_half_width_deg_median']} deg, at peak "
                      f"{rep['band_half_width_deg_at_peak']} deg, max {rep['band_half_width_deg_max']} deg"
                      + ("  ** WIDE BAND AT PEAK, flag in STATUS-A **" if rep["band_flag"] else ""))
            else:
                print(f"{'':17s} NO BAND: {rep['band']}")
        else:
            doc = sphere_doc(site)
            reports[site["id"]] = {"site_id": site["id"], "sphere": True}
            print(f"{site['id']:17s} sphere: flat 0 deg horizon, null occluders")
        C.write_json(out, doc)
    C.write_json(C.REPORTS / "horizons.json", {"sites": reports, "mast_m": MAST_M,
                 "max_range_km": MAX_RANGE_KM, "band_method": BAND_METHOD}, indent=1)
    if failed:
        raise SystemExit("SOME HORIZONS FAILED:\n" + "\n".join(failed))
    print("horizons written to app/public/data/horizon/")


if __name__ == "__main__":
    main()
