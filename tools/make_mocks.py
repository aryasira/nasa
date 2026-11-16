# AI-assisted; see README.
"""Generate MOCK data in app/public/data/mock/ so Agent B can build before Agent A's real data lands.
Shapes follow contracts/ exactly. Values are SYNTHETIC (meta.mock = true) — never show them as results.
Usage: python3 tools/make_mocks.py
"""
import json, math, pathlib
import numpy as np, yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "app/public/data/mock"
META = {"ai_generated": True, "generated_by": "tools/make_mocks.py", "git_sha": "mock", "mock": True}

def ephem():
    hdr = json.loads((ROOT / "contracts/ephem.header.json").read_text())
    n = hdr["n"]
    t_h = np.arange(n, dtype=np.float64)
    syn, drac, anom = 29.530589 * 24, 27.212221 * 24, 27.554550 * 24
    # Sun: sweeps 360 deg of Moon-fixed longitude per synodic month, latitude +-1.54 deg
    lon = math.pi - 2 * math.pi * t_h / syn
    lat = np.radians(1.54) * np.sin(2 * math.pi * t_h / drac)
    sun = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], 1)
    sun_au = np.full(n, 1.0)
    # Earth: near +X (sub-Earth point ~0,0) with libration +-7.9 lon, +-6.7 lat
    elon = np.radians(7.9) * np.sin(2 * math.pi * t_h / anom)
    elat = np.radians(6.7) * np.sin(2 * math.pi * t_h / drac)
    dist = 384400 * (1 - 0.055 * np.cos(2 * math.pi * t_h / anom))
    earth = np.stack([np.cos(elat) * np.cos(elon), np.cos(elat) * np.sin(elon), np.sin(elat)], 1) * dist[:, None]
    rec = np.column_stack([sun, sun_au, earth]).astype("<f4")
    assert rec.shape == (n, 7)
    (OUT / "ephem.bin").write_bytes(rec.tobytes())
    hdr["spice_version"] = "MOCK (no SPICE)"
    hdr["meta"] = META
    (OUT / "ephem.header.json").write_text(json.dumps(hdr, indent=2) + "\n")
    print(f"ephem.bin {rec.nbytes/1e6:.2f} MB, n={n}")

def horizons(sites):
    (OUT / "horizon").mkdir(exist_ok=True)
    az = np.arange(720) * 0.5
    for i, s in enumerate(sites):
        rng = np.random.default_rng(i)
        if s["terrain"] == "lola":
            # a big ridge to the south-ish plus some bumps
            peak_az = 150 + 40 * rng.random()
            elev = 1.8 * np.exp(-((((az - peak_az + 180) % 360) - 180) / 25) ** 2) + 0.4 * np.sin(np.radians(az * 3 + 40 * i)) + 0.5
            elev = np.clip(elev, -0.3, None)
        else:
            elev = 0.15 + 0.1 * np.sin(np.radians(az * 2 + 30 * i))
        dist_km = 5 + 30 * rng.random(720)
        named = (np.abs((((az - 160 + 180) % 360) - 180)) < 30) & (s["terrain"] == "lola")
        lat = s["lat"] + (dist_km / 30.3) * np.cos(np.radians(az))
        doc = {
            "schema_version": 1, "site_id": s["id"], "mast_m": 2.0, "az_step_deg": 0.5,
            "elev_deg": np.round(elev, 4).tolist(),
            "elev_lo_deg": np.round(elev - 0.05, 4).tolist(),
            "elev_hi_deg": np.round(elev + 0.05, 4).tolist(),
            "occluder": {
                "dist_m": np.round(dist_km * 1000).tolist(),
                "lat": np.round(np.clip(lat, -90, 90), 4).tolist(),
                "lon_e": [round(s["lon_e"] % 360, 4)] * 720,
                "feature_id": ["mock_ridge" if x else None for x in named],
            },
            "dem": {"product": "MOCK", "res_m": None, "sigma_m": None, "max_range_km": None},
            "meta": META,
        }
        (OUT / "horizon" / f"{s['id']}.json").write_text(json.dumps(doc) + "\n")
    print(f"{len(sites)} horizon files")

def small_files(sites):
    feats = {"schema_version": 1, "meta": META, "features": [
        {"id": "mock_ridge", "name": "Mock Ridge (synthetic)", "name_status": "informal", "gazetteer_id": None,
         "type": "ridge", "lat": -80.4, "lon_e": 1.4, "radius_km": 10, "source": {"org": "MOCK", "url": "mock://"}}]}
    (OUT / "features.json").write_text(json.dumps(feats, indent=2) + "\n")
    fx = {"schema_version": 1, "meta": META, "fixtures": [
        {"site_id": "im1", "utc": "2024-02-22T23:24:00Z", "body": "sun", "horizons_az": 0.0, "horizons_el": 0.0,
         "tol_deg": 0.01, "query_url": "mock://"}]}
    (OUT / "fixtures.json").write_text(json.dumps(fx, indent=2) + "\n")
    st = {"schema_version": 1, "sites": sites, "meta": META}
    (OUT / "sites.json").write_text(json.dumps(st, indent=2) + "\n")

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sites = yaml.safe_load((ROOT / "data-src/sites.yaml").read_text())["sites"]
    ephem(); horizons(sites); small_files(sites)

if __name__ == "__main__":
    main()
