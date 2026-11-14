# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Tests for the reference engine (docs/engine-spec.md) on MOCK data.
Run: python3 -m pytest -q tests
"""
import json
import pathlib
import sys

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from engine_ref import DEFAULT_DATA, ROOT, Engine, parse_utc, sep_deg, site_vector  # noqa: E402
import make_golden  # noqa: E402

GOLDEN = ROOT / "tests/golden/engine_vectors.json"
pytestmark = pytest.mark.skipif(not (DEFAULT_DATA / "ephem.bin").exists(),
                                reason="mock data missing: run python3 tools/make_mocks.py")


@pytest.fixture(scope="module")
def eng():
    return Engine(DEFAULT_DATA)


@pytest.fixture(scope="module")
def year():
    return parse_utc("2024-01-01T00:00:00Z") + 3600.0 * np.arange(366 * 24)


def test_parallax_topocentric_vs_geocentric(eng, year):
    """|topocentric - geocentric Earth direction|: max over sites and a year must be 0.20..0.30 deg."""
    worst = 0.0
    for sid, s in eng.sites.items():
        _, _, earth = eng.ephem.sample(year)
        topo = earth - site_vector(s["lat"], s["lon_e"], s["elev_m"])[None, :]
        worst = max(worst, float(sep_deg(earth, topo).max()))
    assert 0.20 <= worst <= 0.30, worst


def test_parallax_in_observe(eng, year):
    o = eng.observe("im1", year)
    d = np.abs(o["earth_el"] - o["earth_el_geocentric"])
    assert d.max() > 0.2  # topocentric really is used for earth_el
    assert np.allclose(o["earth_az"], o["earth_az_geocentric"], atol=1e-6)  # sphere: parallax is purely vertical


def test_sun_el_bounded_near_pole(eng, year):
    for sid in ["connecting_ridge", "im2", "im1"]:
        lat = eng.sites[sid]["lat"]
        el = eng.observe(sid, year)["sun_el"]
        bound = 90.0 - abs(lat) + 1.6
        assert np.all(np.abs(el) <= bound), (sid, float(np.abs(el).max()), bound)


def test_ranges(eng, year):
    for sid in eng.sites:
        o = eng.observe(sid, year[::7])
        for b in ("sun", "earth"):
            assert np.all((o[f"{b}_frac"] >= 0) & (o[f"{b}_frac"] <= 1))
            assert np.all((o[f"{b}_az"] >= 0) & (o[f"{b}_az"] < 360))
            assert np.all(np.abs(o[f"{b}_el"]) <= 90)
        assert np.all(o["eclipse_total"] <= o["eclipse_partial"])


def test_sample_renormalises_and_hits_rows(eng):
    t0 = eng.ephem.t0
    sun, au, earth = eng.ephem.sample([t0, t0 + 1800.0, eng.ephem.t_last])
    assert np.allclose(np.linalg.norm(sun, axis=1), 1.0, atol=1e-12)
    assert np.allclose(earth[0], eng.ephem.rows[0, 4:7]) and np.allclose(earth[2], eng.ephem.rows[-1, 4:7])
    assert np.allclose(earth[1], 0.5 * (eng.ephem.rows[0, 4:7] + eng.ephem.rows[1, 4:7]))
    with pytest.raises(ValueError):
        eng.ephem.sample(t0 - 1.0)


def test_golden_file_sanity():
    doc = json.loads(GOLDEN.read_text())
    assert doc["meta"] == {"ai_generated": True, "generated_by": "tests/reference/make_golden.py", "mock": True}
    assert GOLDEN.stat().st_size < 200_000
    for i in doc["instants"]:
        for b in ("sun", "earth"):
            assert 0 <= i[b]["fraction"] <= 1 and 0 <= i[b]["az"] < 360
    for w in doc["windows"]:
        m = w["metrics"]
        assert 0 <= m["earth_visible_pct"] <= 100
        assert m["both_visible_h"] <= min(m["sunlit_h"], m["earth_visible_pct"] / 100 * w["days"] * 24) + 1e-6


def _cmp(a, b, tol, path=""):
    """Recursive compare of golden (a) vs regenerated (b) using the file's tolerances."""
    if isinstance(a, dict):
        assert a.keys() == b.keys(), path
        for k in a:
            _cmp(a[k], b[k], tol, f"{path}.{k}")
    elif isinstance(a, list):
        assert len(a) == len(b), path
        for j, (x, y) in enumerate(zip(a, b)):
            _cmp(x, y, tol, f"{path}[{j}]")
    elif isinstance(a, bool) or a is None or isinstance(a, str):
        if isinstance(a, str) and path.endswith(("sunset_utc", "earthset_utc")):
            assert b is not None and abs(parse_utc(a) - parse_utc(b)) <= tol["event_s"], path
        else:
            assert a == b, path
    else:
        key = path.rsplit(".", 1)[-1]
        t = {"earth_visible_pct": tol["pct"], "radius": tol["radius_deg"], "fraction": tol["fraction"],
             "dist_km": 1e-2}.get(key)
        if t is None:
            t = tol["hours"] if key.endswith("_h") or key == "days" else tol["az_el_deg"]
        d = abs(a - b)
        if key.endswith("az"):
            d = min(d, 360 - d)
        assert d <= t, (path, a, b)


def test_golden_regenerates():
    doc = json.loads(GOLDEN.read_text())
    _cmp(doc, json.loads(json.dumps(make_golden.build(DEFAULT_DATA))), doc["tolerances"])
