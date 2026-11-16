# AI-assisted; see README.
"""Contract tests. Validates every data file in app/public/data (real) and app/public/data/mock.
Run: python3 -m pytest -q tests
"""
import json, pathlib, warnings
import numpy as np, pytest, jsonschema, yaml
from referencing import Registry, Resource

ROOT = pathlib.Path(__file__).resolve().parents[2]
C = ROOT / "contracts"
DATA_DIRS = [d for d in [ROOT / "app/public/data", ROOT / "app/public/data/mock"] if d.exists()]

def schema(name):
    return json.loads((C / name).read_text())

REG = Registry().with_resources([(n, Resource.from_contents(schema(n))) for n in
    ["sites.schema.json", "horizon.schema.json", "features.schema.json", "fixtures.schema.json"]])

def validate(doc, name):
    jsonschema.Draft202012Validator(schema(name), registry=REG).validate(doc)

@pytest.mark.parametrize("d", DATA_DIRS, ids=lambda d: d.name)
def test_sites(d):
    p = d / "sites.json"
    if not p.exists(): pytest.skip("no sites.json")
    validate(json.loads(p.read_text()), "sites.schema.json")

@pytest.mark.parametrize("d", DATA_DIRS, ids=lambda d: d.name)
def test_features_and_fixtures(d):
    for f, s in [("features.json", "features.schema.json"), ("fixtures.json", "fixtures.schema.json")]:
        p = d / f
        if p.exists(): validate(json.loads(p.read_text()), s)

@pytest.mark.parametrize("d", DATA_DIRS, ids=lambda d: d.name)
def test_horizons(d):
    files = sorted((d / "horizon").glob("*.json")) if (d / "horizon").exists() else []
    if not files: pytest.skip("no horizon files")
    for p in files:
        doc = json.loads(p.read_text())
        validate(doc, "horizon.schema.json")
        assert doc["site_id"] == p.stem
        lo, mid, hi = map(np.array, (doc["elev_lo_deg"], doc["elev_deg"], doc["elev_hi_deg"]))
        assert np.all(lo <= mid + 1e-9) and np.all(mid <= hi + 1e-9), f"{p.name}: lo<=mid<=hi violated"

@pytest.mark.parametrize("d", DATA_DIRS, ids=lambda d: d.name)
def test_ephem(d):
    hp, bp = d / "ephem.header.json", d / "ephem.bin"
    if not bp.exists(): pytest.skip("no ephem.bin")
    hdr = json.loads(hp.read_text())
    ref = json.loads((C / "ephem.header.json").read_text())
    for k in ["t0_utc", "step_s", "n", "layout", "dtype", "frame", "abcorr", "record_bytes"]:
        assert hdr[k] == ref[k], k
    assert hdr["meta"]["ai_generated"] is True
    a = np.frombuffer(bp.read_bytes(), dtype="<f4")
    assert a.size == hdr["n"] * 7
    a = a.reshape(-1, 7)
    norms = np.linalg.norm(a[:, :3], axis=1)
    assert np.allclose(norms, 1, atol=1e-5), "sun vectors must be unit"
    ed = np.linalg.norm(a[:, 4:7], axis=1)
    assert ed.min() > 350000 and ed.max() < 410000, "earth distance km out of range"

def test_sites_yaml_has_sources():
    src = yaml.safe_load((ROOT / "data-src/sites.yaml").read_text())
    ids = [s["id"] for s in src["sites"]]
    assert len(ids) == len(set(ids)), "duplicate site ids"
    todo = [s["id"] for s in src["sites"] if "TODO" in json.dumps(s["source"])]
    if todo:
        warnings.warn(f"sites with TODO sources (must be fixed before submission): {todo}")

def test_ai_disclosure_in_meta():
    for d in DATA_DIRS:
        for p in d.rglob("*.json"):
            doc = json.loads(p.read_text())
            if isinstance(doc, dict) and "meta" in doc:
                assert doc["meta"].get("ai_generated") is True, f"{p}: meta.ai_generated must be true"


def test_validation_scorecard():
    """Added by Agent A (round 3): app/public/data/validation.json against contracts/validation.schema.json."""
    p = ROOT / "app/public/data/validation.json"
    if not p.exists(): pytest.skip("no validation.json")
    doc = json.loads(p.read_text())
    validate(doc, "validation.schema.json")
    assert doc["meta"]["mock"] is False and doc["meta"]["ai_generated"] is True
    h = doc["horizons_check"]
    assert h["passed"] and max(h["max_az_gap_deg"], h["max_el_gap_deg"]) <= h["tol_deg"]
    # "1/N of the Sun's width" must never overstate the match
    assert h["max_gap_as_fraction_of_sun_diameter"]["one_over"] <= h["max_gap_as_fraction_of_sun_diameter"]["exact_ratio"]
    assert h["n_fixtures"] == len(json.loads((ROOT / "app/public/data/fixtures.json").read_text())["fixtures"])
    for line in doc["lead_lines"]:
        lo, hi = line["sunlit_h_range"]
        assert lo <= line["sunlit_h"] <= hi
