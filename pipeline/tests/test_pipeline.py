# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Self-tests for Agent A's pipeline on synthetic inputs (no network).

Run:  python -m pytest -q pipeline/tests
These check the code paths and the maths. The real acceptance tests are
check_vs_horizons.py (against live JPL Horizons) and tests/contracts.
"""
import json
import math
import pathlib
import sys
import types

import numpy as np
import pytest

PIPE = pathlib.Path(__file__).resolve().parents[1]
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
import common as C                    # noqa: E402
import check_vs_horizons as chk       # noqa: E402
import fetch_horizons as fh           # noqa: E402
import make_ephem                     # noqa: E402

rasterio = pytest.importorskip("rasterio")
pyproj = pytest.importorskip("pyproj")
from rasterio.transform import from_origin      # noqa: E402
import horizon_lib as hl              # noqa: E402
import make_horizons as mh            # noqa: E402

R = 1737400.0
CRS = pyproj.CRS.from_proj4(f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={R} +units=m")
FWD = pyproj.Transformer.from_crs(CRS.geodetic_crs, CRS, always_xy=True)
GEOD = pyproj.Geod(a=R, b=R)
LAT, LON = -89.5, 40.0
SX, SY = FWD.transform(LON, LAT)


def write_dem(path, cx, cy, half, res, fn):
    n = int(2 * half / res)
    xs = cx - half + (np.arange(n) + 0.5) * res
    ys = cy + half - (np.arange(n) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    with rasterio.open(path, "w", driver="GTiff", height=n, width=n, count=1,
                       dtype="float32", crs=CRS.to_wkt(), nodata=-9999,
                       transform=from_origin(cx - half, cy + half, res, res)) as ds:
        ds.write(fn(X, Y).astype("float32"), 1)
    return path


def bump(x0, y0, height, width):
    return lambda X, Y: height * np.exp(-((X - x0) ** 2 + (Y - y0) ** 2) / (2 * width ** 2))


# ---------------- horizon_lib ----------------
def test_flat_sphere_gives_the_dip(tmp_path):
    p = write_dem(tmp_path / "flat.tif", SX, SY, 10000, 10, lambda X, Y: np.zeros_like(X))
    h = hl.horizon(LAT, LON, [p], mast_m=2.0, az_step=1.0, max_range_km=9)
    dip = -math.degrees(math.acos(R / (R + 2.0)))
    assert np.abs(h["elev_deg"] - dip).max() < 2e-3
    # the limb of a smooth DEM is real terrain, about 2.64 km away
    assert np.all(np.abs(h["occ_dist_m"] - 2636) < 120)


def test_peak_angle_azimuth_and_occluder_position(tmp_path):
    plon, plat, _ = GEOD.fwd(LON, LAT, 90.0, 4000.0)
    px, py = FWD.transform(plon, plat)
    p = write_dem(tmp_path / "peak.tif", SX, SY, 10000, 10, bump(px, py, 500.0, 300.0))
    h = hl.horizon(LAT, LON, [p], mast_m=2.0, az_step=0.5, max_range_km=9.5)
    th = 4000.0 / R
    want = math.degrees(math.atan2((R + 500) * math.cos(th) - (R + 2), (R + 500) * math.sin(th)))
    i = int(h["elev_deg"].argmax())
    assert abs(h["az_deg"][i] - 90.0) <= 0.5
    assert want - 0.01 <= h["elev_deg"][i] <= want + 0.25
    # occluder sits on the near flank of the peak, at the peak's bearing
    _, _, d = GEOD.inv(plon, plat, h["occ_lon_e"][i], h["occ_lat"][i])
    assert d < 400 and 3500 < h["occ_dist_m"][i] <= 4000
    faz, _, dist = GEOD.inv(LON, LAT, h["occ_lon_e"][i], h["occ_lat"][i])
    assert abs((faz - 90 + 180) % 360 - 180) < 0.01 and abs(dist - h["occ_dist_m"][i]) < 1.0


def test_sigma_bands_and_nested_dems(tmp_path):
    flon, flat_, _ = GEOD.fwd(LON, LAT, 135.0, 60000.0)
    fx, fy = FWD.transform(flon, flat_)
    near = write_dem(tmp_path / "near.tif", SX, SY, 5000, 10, lambda X, Y: np.zeros_like(X))
    far = write_dem(tmp_path / "far.tif", SX, SY, 80000, 100, bump(fx, fy, 5000.0, 3000.0))
    h = hl.horizon(LAT, LON, [near, far], mast_m=2.0, az_step=1.0, max_range_km=75,
                   sigma_m=[0.5, 20.0])
    lo, mid, hi = h["elev_lo_deg"], h["elev_deg"], h["elev_hi_deg"]
    assert np.all(lo <= mid + 1e-12) and np.all(mid <= hi + 1e-12)
    i = int(mid.argmax())
    assert abs(h["az_deg"][i] - 135) <= 1 and h["occ_dem_index"][i] == 1
    # far ridge: raising terrain by 20 m at ~60 km is about 0.019 deg
    assert 0.012 < hi[i] - mid[i] < 0.03
    assert len(h["dems"]) == 2 and h["coverage_km"].min() > 70


def test_error_map_bands(tmp_path):
    # Ridge 5 km away on a 10 m grid. Error map: 2 m everywhere, 0.5 m at the site.
    plon, plat, _ = GEOD.fwd(LON, LAT, 60.0, 5000.0)
    px, py = FWD.transform(plon, plat)
    dem = write_dem(tmp_path / "d.tif", SX, SY, 8000, 10, bump(px, py, 600.0, 400.0))
    err = write_dem(tmp_path / "e.tif", SX, SY, 8000, 10,
                    lambda X, Y: np.where(np.hypot(X - SX, Y - SY) < 100, 0.5, 2.0))
    h = hl.horizon(LAT, LON, [dem], az_step=1.0, max_range_km=7, err_paths=[err])
    i = int(h["elev_deg"].argmax())
    assert abs(h["site_sigma_m"] - 0.5) < 1e-6 and abs(h["occ_sigma_m"][i] - 2.0) < 1e-6
    d = h["occ_dist_m"][i]
    want = math.degrees((2.0 + 0.5) / d)          # small-angle estimate
    up, down = h["elev_hi_deg"][i] - h["elev_deg"][i], h["elev_deg"][i] - h["elev_lo_deg"][i]
    assert abs(up - want) < 0.15 * want and abs(down - want) < 0.15 * want
    assert np.all(h["elev_lo_deg"] <= h["elev_deg"]) and np.all(h["elev_deg"] <= h["elev_hi_deg"])
    # without an error map nothing is claimed
    h0 = hl.horizon(LAT, LON, [dem], az_step=1.0, max_range_km=7)
    assert np.array_equal(h0["elev_lo_deg"], h0["elev_hi_deg"]) and h0["site_sigma_m"] is None
    assert np.allclose(h0["elev_deg"], h["elev_deg"])
    # an error map with nonsense values is refused
    bad = write_dem(tmp_path / "bad.tif", SX, SY, 8000, 10, lambda X, Y: np.full_like(X, -5.0))
    with pytest.raises(ValueError):
        hl.horizon(LAT, LON, [dem], az_step=5.0, max_range_km=7, err_paths=[bad])


def test_fine_layer_is_used_only_inside_its_radius(tmp_path):
    flon, flat_, _ = GEOD.fwd(LON, LAT, 135.0, 20000.0)
    fx, fy = FWD.transform(flon, flat_)
    # the fine grid would show a huge wall at 20 km, but it is limited to 5 km
    fine = write_dem(tmp_path / "fine.tif", SX, SY, 30000, 20, bump(fx, fy, 9000.0, 2000.0))
    coarse = write_dem(tmp_path / "coarse.tif", SX, SY, 30000, 100, lambda X, Y: np.zeros_like(X))
    h = hl.horizon(LAT, LON, [fine, coarse], az_step=5.0, max_range_km=28, dem_radius_km=[5.0, None])
    assert h["elev_deg"].max() < 1.0
    far = h["occ_dist_m"] > 6000
    assert not far.any() or np.all(h["occ_dem_index"][far] == 1)


def test_null_occluders_where_only_the_assumed_sphere_is_higher(tmp_path):
    # Site on a narrow 1000 m spike over a plain at datum height. The plain
    # inside the DEM lies far below the sphere's limb as seen from the top,
    # and the limb itself is beyond the DEM, so no real cell sets the horizon.
    p = write_dem(tmp_path / "spike.tif", SX, SY, 10000, 10, bump(SX, SY, 1000.0, 60.0))
    h = hl.horizon(LAT, LON, [p], mast_m=2.0, az_step=2.0, max_range_km=9)
    assert np.isnan(h["occ_dist_m"]).all() and np.isnan(h["occ_lat"]).all()
    dip = -math.degrees(math.acos(R / (R + h["site_height_m"] + 2.0)))
    assert np.abs(h["elev_deg"] - dip).max() < 1e-9
    assert np.array_equal(h["elev_lo_deg"], h["elev_deg"])


def test_sites_below_the_reference_sphere_and_outside_the_dem(tmp_path):
    p = write_dem(tmp_path / "low.tif", SX, SY, 8000, 20, lambda X, Y: np.full_like(X, -3000.0))
    h = hl.horizon(LAT, LON, [p], mast_m=2.0, az_step=5.0, max_range_km=7)
    assert np.all(np.isfinite(h["elev_deg"])) and abs(h["site_height_m"] + 3000) < 1e-6
    with pytest.raises(ValueError):
        hl.horizon(-60.0, 100.0, [p])         # far outside the DEM

def test_horizon_files_meet_the_contract(tmp_path, monkeypatch):
    import jsonschema
    from referencing import Registry, Resource
    names = ["sites.schema.json", "horizon.schema.json", "features.schema.json"]
    load = lambda n: json.loads((ROOT / "contracts" / n).read_text())
    reg = Registry().with_resources([(n, Resource.from_contents(load(n))) for n in names])
    check = lambda doc, n: jsonschema.Draft202012Validator(load(n), registry=reg).validate(doc)

    plon, plat, _ = GEOD.fwd(LON, LAT, 200.0, 3000.0)
    px, py = FWD.transform(plon, plat)
    write_dem(tmp_path / "a.tif", SX, SY, 6000, 10, bump(px, py, 400.0, 250.0))
    monkeypatch.setattr(mh, "DEMS", {"a.tif": {"url": "", "res_m": 10, "product": "TEST"}})
    monkeypatch.setattr(mh, "PLAN", {"t": ["a.tif"]})
    monkeypatch.setattr(mh, "OVERRIDE", {})
    monkeypatch.setattr(mh, "MAX_RANGE_KM", 5.5)
    src = {"org": "TEST", "url": "test://"}
    feats = [{"id": "big_mons", "name": "Big Mons", "name_status": "iau", "gazetteer_id": 1, "type": "mons",
              "lat": plat, "lon_e": plon % 360, "radius_km": 50.0, "source": src},
             {"id": "test_peak", "name": "Test peak", "name_status": "informal", "gazetteer_id": None,
              "type": "massif", "lat": plat, "lon_e": plon % 360, "radius_km": 2.0, "source": src},
             {"id": "no_radius", "name": "Statio", "name_status": "iau", "gazetteer_id": 2, "type": "statio",
              "lat": plat, "lon_e": plon % 360, "radius_km": None, "source": src}]
    site = {"id": "t", "lat": LAT, "lon_e": LON, "elev_m": None, "terrain": "lola"}
    doc, rep = mh.lola_doc(site, [tmp_path], feats)
    check(doc, "horizon.schema.json")
    check(mh.sphere_doc({"id": "s"}), "horizon.schema.json")
    check(mh.features_doc(feats), "features.schema.json")
    i = int(np.argmax(doc["elev_deg"]))
    # the smallest feature that contains the occluder wins; big_mons (50 km)
    # contains the site itself, so it is never used as an occluder name
    assert doc["occluder"]["feature_id"][i] == "test_peak"
    assert set(rep["names_seen"]) == {"test_peak"} and doc["site_used"]["stands_on"] == ["big_mons"]
    assert None in doc["occluder"]["feature_id"]
    lat = np.array([plat, plat]); lon = np.array([plon % 360, plon % 360])
    assert mh.match_features(lat, lon, feats) == ["test_peak"] * 2            # no site given
    only_big = [feats[0]]
    assert mh.match_features(lat, lon, only_big) == ["big_mons"] * 2
    assert mh.match_features(lat, lon, only_big, site=(LAT, LON)) == [None, None]
    assert doc["site_used"]["differs_from_catalog"] is False
    assert doc["meta"]["ai_generated"] is True and doc["dem"]["sigma_m"] is None
    assert "band" not in doc and rep["band"].startswith("no band")
    # with an error map the band is filled and still meets the contract
    write_dem(tmp_path / "a_err.tif", SX, SY, 6000, 10, lambda X, Y: np.full_like(X, 1.5))
    monkeypatch.setattr(mh, "DEMS", {"a.tif": {"url": "", "res_m": 10, "product": "TEST", "err": "a_err.tif"}})
    doc2, rep2 = mh.lola_doc(site, [tmp_path], feats)
    check(doc2, "horizon.schema.json")
    assert doc2["dem"]["sigma_m"] == 1.5 and doc2["band"]["site_sigma_m"] == 1.5
    assert doc2["elev_deg"] == doc["elev_deg"] and rep2["band"] == "ok"
    assert doc2["elev_hi_deg"][i] > doc2["elev_deg"][i] > doc2["elev_lo_deg"][i]
    assert rep2["band_half_width_deg_max"] > 0


def test_make_horizons_main_end_to_end(tmp_path, monkeypatch, capsys):
    # catalogue has one terrain site and one sphere site; a round-2 site is not in it yet
    plon, plat, _ = GEOD.fwd(LON, LAT, 200.0, 3000.0)
    px, py = FWD.transform(plon, plat)
    dems = tmp_path / "dems"
    dems.mkdir()
    write_dem(dems / "a.tif", SX, SY, 6000, 10, bump(px, py, 400.0, 250.0))
    write_dem(dems / "a_err.tif", SX, SY, 6000, 10, lambda X, Y: np.full_like(X, 0.4))
    monkeypatch.setattr(mh, "DEMS", {"a.tif": {"url": "", "res_m": 10, "product": "TEST", "err": "a_err.tif"}})
    monkeypatch.setattr(mh, "PLAN", {"t": ["a.tif"], "extra": ["a.tif"]})
    monkeypatch.setattr(mh, "ROUND2_SITES", [{"id": "extra", "lat": LAT - 0.01, "lon_e": LON,
                                              "elev_m": None, "terrain": "lola"}])
    monkeypatch.setattr(mh, "MAX_RANGE_KM", 5.0)
    monkeypatch.setattr(C, "DATA", tmp_path / "data")
    monkeypatch.setattr(C, "REPORTS", tmp_path / "reports")
    monkeypatch.setattr(C, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(C, "load_sites", lambda: [
        {"id": "t", "lat": LAT, "lon_e": LON, "elev_m": 10, "terrain": "lola"},
        {"id": "s", "lat": 0.0, "lon_e": 0.0, "elev_m": 0, "terrain": "sphere"}])
    monkeypatch.setattr(sys, "argv", ["make_horizons.py", "--dem-dir", str(dems), "--fine", "40"])
    mh.main()
    out = capsys.readouterr().out
    assert "FAILED" not in out and "NO BAND" not in out
    for sid in ("t", "s", "extra"):
        assert (tmp_path / "data/horizon" / f"{sid}.json").exists()
    extra = json.loads((tmp_path / "data/horizon/extra.json").read_text())
    assert "ROUND2-A.md" in extra["site_used"]["point_from"] and extra["dem"]["sigma_m"] == 0.4
    rep = json.loads((tmp_path / "reports/horizons.json").read_text())
    assert rep["meta"]["ai_generated"] is True and rep["sites"]["t"]["band"] == "ok"
    assert rep["sites"]["t"]["band_flag"] is False
    # the science doc builds from these reports and shows the band table
    import make_science_doc as msd
    monkeypatch.setattr(C, "DOCS", tmp_path / "docs")
    msd.main()
    text = (tmp_path / "docs/science.md").read_text()
    assert "| t |" in text and "| extra |" in text and "Pending: no terrain horizon has a band" not in text


def test_last_ephemeris_row_is_accepted():
    import check_vs_horizons as cv
    hdr = {"t0_utc": "2023-01-01T00:00:00Z", "step_s": 3600}
    rec = np.array([[1, 0, 0, 1, 1, 2, 3], [0, 1, 0, 1, 4, 5, 6], [0, 0, 1, 1, 7, 8, 9]], dtype="float64")
    sun, earth = cv.vectors_at(hdr, rec, "2023-01-01T02:00:00Z")
    assert np.allclose(sun, (0, 0, 1)) and np.allclose(earth, (7, 8, 9))
    sun, earth = cv.vectors_at(hdr, rec, "2023-01-01T00:00:00Z")
    assert np.allclose(sun, (1, 0, 0))
    for bad in ("2022-12-31T23:59:59Z", "2023-01-01T02:00:01Z"):
        with pytest.raises(ValueError):
            cv.vectors_at(hdr, rec, bad)


def test_round2_sites_have_a_dem_plan():
    ids = {x["id"] for x in mh.ROUND2_SITES}
    assert ids == {"shackleton_sr1", "shackleton_sr2"} and ids <= set(mh.PLAN) and ids <= mh.FINE_SITES
    for names in mh.PLAN.values():
        for n in names:
            assert mh.DEMS[n]["err"] in mh.ERR_URL
    for n in mh.FINE.values():
        assert mh.DEMS[n]["err"] in mh.ERR_URL and mh.DEMS[n]["radius_km"]


def test_real_feature_list_is_valid_and_sourced():
    feats = mh.load_features()
    ids = [f["id"] for f in feats]
    assert len(ids) == len(set(ids))
    for f in feats:
        if f["name_status"] == "iau":
            assert isinstance(f["gazetteer_id"], int) and str(f["gazetteer_id"]) in f["source"]["url"]
        else:
            assert f["gazetteer_id"] is None
    if mh.SEED.exists():
        assert {"mons_malapert", "mons_mouton", "shackleton"} <= set(ids)
    # the PGDA Malapert summit used earlier falls inside IAU Mons Malapert
    got = mh.match_features(np.array([-85.987678, -89.438909, 10.0]), np.array([2.068132, 222.85643, 10.0]), feats)
    assert got[1] == "connecting_ridge_summit" and got[2] is None
    if mh.SEED.exists():
        assert got[0] == "mons_malapert"


# ---------------- ephemeris writer ----------------
def model(hours):
    """Smooth made-up Sun and Earth motion in the Moon-fixed frame."""
    t = np.asarray(hours, dtype="float64")
    lon = math.pi - 2 * math.pi * t / (29.530589 * 24)
    lat = np.radians(1.54) * np.sin(2 * math.pi * t / (27.212221 * 24))
    sun = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1) * 1.0e8 * 1.47
    elon = np.radians(7.9) * np.sin(2 * math.pi * t / (27.55455 * 24))
    elat = np.radians(6.7) * np.sin(2 * math.pi * t / (27.212221 * 24) + 1.0)
    dist = 384400 * (1 - 0.055 * np.cos(2 * math.pi * t / (27.55455 * 24)))
    earth = np.stack([np.cos(elat) * np.cos(elon), np.cos(elat) * np.sin(elon), np.sin(elat)], -1) * dist[..., None]
    return sun, earth


def test_make_ephem_writes_the_contract_layout(tmp_path, monkeypatch):
    hdr = json.loads((ROOT / "contracts/ephem.header.json").read_text())
    fake = types.ModuleType("spiceypy")
    fake.__version__ = "0.0-test"
    fake.kclear = lambda: None
    fake.furnsh = lambda p: None
    fake.tkvrsn = lambda k: "CSPICE_TEST"
    fake.str2et = lambda s: (C.parse_utc(s + "Z") - C.parse_utc("2000-01-01T12:00:00Z")).total_seconds()
    et0 = fake.str2et("2024-01-01T00:00:00")

    def spkpos(targ, et, ref, abcorr, obs):
        assert (ref, abcorr, obs) == ("MOON_ME", "LT+S", "MOON")
        sun, earth = model((np.asarray(et) - et0) / 3600.0)
        return (sun if targ == "SUN" else earth), np.zeros(len(et))
    fake.spkpos = spkpos
    monkeypatch.setitem(sys.modules, "spiceypy", fake)
    kern = tmp_path / "kernels"
    kern.mkdir()
    for k in hdr["kernels"]:
        (kern / k).write_text("x")
    monkeypatch.setattr(C, "KERNELS", kern)
    monkeypatch.setattr(C, "DATA", tmp_path / "data")
    monkeypatch.setattr(C, "REPORTS", tmp_path / "reports")
    make_ephem.main()

    out = json.loads((tmp_path / "data/ephem.header.json").read_text())
    for k in ["t0_utc", "step_s", "n", "layout", "dtype", "frame", "abcorr", "record_bytes"]:
        assert out[k] == hdr[k]
    assert out["meta"]["ai_generated"] is True and out["meta"]["mock"] is False
    a = np.frombuffer((tmp_path / "data/ephem.bin").read_bytes(), dtype="<f4").reshape(-1, 7)
    assert a.shape[0] == hdr["n"]
    assert np.allclose(np.linalg.norm(a[:, :3], axis=1), 1, atol=1e-5)
    ed = np.linalg.norm(a[:, 4:7], axis=1)
    assert 350000 < ed.min() and ed.max() < 410000
    rep = json.loads((tmp_path / "reports/ephem.json").read_text())
    assert abs(rep["sun_lat_deg"][1] - 1.54) < 0.01 and abs(rep["earth_lon_deg"][1] - 7.9) < 0.01


# ---------------- Horizons reply parser and the residual check ----------------
REPLY = """API VERSION: 1.3
header line
*****
 Date_________JDUT, , ,Azimuth_(a-app),Elevation_(a-app),
*****
$$SOE
 2461045.520833333,*,m, 123.456789,  -1.234567,
 2461049.479166667, , , 200.000000,   5.500000,
$$EOE
*****
legend line about markers
"""


def test_parse_reply_and_query():
    rows, head, foot = fh.parse_reply(REPLY)
    assert rows[0][:3] == (2461045.520833333, 123.456789, -1.234567)
    assert rows[0][3:] == ("*", "m") and rows[1][3:] == ("", "")
    assert any("legend" in l for l in foot)
    assert C.iso_z(C.jd_to_utc(2461045.520833333)) == "2026-01-05T00:30:00Z"
    site = {"id": "x", "lat": -80.13, "lon_e": 1.44, "elev_m": 2579,
            "landing_utc": "2024-02-22T23:24:00Z"}
    start = fh.start_epoch(site)
    assert C.iso_z(start) == "2024-02-22T23:30:00Z"
    url = fh.query_url("earth", site, start)
    assert "coord%40301" in url and "399" in url and "1.440000%2C-80.130000%2C2.5790" in url
    old = dict(site, landing_utc="1969-07-20T20:17:40Z")
    assert C.iso_z(fh.start_epoch(old)) == fh.DEFAULT_START
    # round 2: the ephemeris starts in 2023, but round-1 epochs must not move
    hdr = json.loads((ROOT / "contracts/ephem.header.json").read_text())
    assert hdr["t0_utc"] == "2023-01-01T00:00:00Z" and hdr["n"] == 70128
    assert (C.parse_utc("2030-12-31T23:00:00Z") - C.parse_utc(hdr["t0_utc"])).total_seconds() == 3600 * (hdr["n"] - 1)
    ch3 = {"id": "chandrayaan3", "lat": -69.3741, "lon_e": 32.32, "elev_m": 532,
           "landing_utc": "2023-08-23T12:33:00Z"}
    ser = fh.series(ch3)
    assert [(C.iso_z(t), st) for t, st in ser] == [(fh.DEFAULT_START, 71), ("2023-08-23T12:30:00Z", 27)]
    last = ser[1][0] + C.datetime.timedelta(hours=27 * 9)
    assert C.iso_z(last) == "2023-09-02T15:30:00Z"
    assert "27+h" in fh.query_url("sun", ch3, *ser[1]) or "27%20h" in fh.query_url("sun", ch3, *ser[1])
    assert len(fh.series(site)) == 1 and len(fh.series(old)) == 1


def _make_case(tmp_path, topocentric):
    n = 2000
    sun, earth = model(np.arange(n))
    rec = make_ephem.records(sun, earth)
    (tmp_path / "ephem.bin").write_bytes(rec.tobytes())
    hdr = {"t0_utc": "2024-01-01T00:00:00Z", "step_s": 3600, "n": n}
    (tmp_path / "ephem.header.json").write_text(json.dumps(hdr))
    sites = [{"id": "p", "lat": -84.79, "lon_e": 29.2, "elev_m": 1500},
             {"id": "e", "lat": 0.67, "lon_e": 23.47, "elev_m": -1926}]
    fixtures = []
    for s in sites:
        frame, sv = C.local_frame(s["lat"], s["lon_e"]), C.site_vector_km(s)
        for k in range(10):
            hours = 100.5 + 71 * k
            sun1, earth1 = model(hours)          # exact, not interpolated
            topo = tuple(earth1 - np.array(sv)) if topocentric else tuple(earth1)
            utc = C.iso_z(C.parse_utc(hdr["t0_utc"]) + C.datetime.timedelta(hours=hours))
            for body, vec in (("sun", tuple(sun1)), ("earth", topo)):
                az, el = C.az_el(vec, frame)
                fixtures.append({"site_id": s["id"], "utc": utc, "body": body, "horizons_az": az,
                                 "horizons_el": el, "tol_deg": 0.01, "query_url": "test://"})
    (tmp_path / "fixtures.json").write_text(json.dumps({"fixtures": fixtures}))
    return sites


def test_residual_check_passes_on_consistent_data(tmp_path):
    rep = chk.run(tmp_path, _make_case(tmp_path, topocentric=True))
    assert rep["passed"] and rep["n_fixtures"] == 40
    assert max(r["max_el_gap_deg"] for r in rep["rows"]) < 2e-3
    assert 0.05 < rep["max_earth_parallax_deg"] < rep["parallax_upper_bound_deg"]


def test_residual_check_catches_a_missing_parallax(tmp_path):
    rep = chk.run(tmp_path, _make_case(tmp_path, topocentric=False))
    assert not rep["passed"]
    assert {f["body"] for f in rep["failures"]} == {"earth"}
