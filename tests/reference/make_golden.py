# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Write tests/golden/engine_vectors.json from the MOCK data using engine_ref.py (docs/engine-spec.md).

Usage: python3 tests/reference/make_golden.py [data_dir]
Values are SYNTHETIC (mock ephemeris + mock horizons). Regenerate whenever tools/make_mocks.py
or docs/engine-spec.md changes, then re-run Agent B's Vitest cross-check.
"""
from __future__ import annotations

import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from engine_ref import DEFAULT_DATA, ROOT, Engine, fmt_utc, parse_utc  # noqa: E402

OUT = ROOT / "tests/golden/engine_vectors.json"
SITES = ["im1", "slim", "apollo11", "chandrayaan3"]
FIXED_INSTANTS = [
    "2024-01-01T00:00:00Z",  # first ephemeris row
    "2024-01-19T15:20:00Z",
    "2024-02-22T23:24:00Z",  # non-hour
    "2024-03-06T12:30:45Z",
    "2024-08-15T06:45:00Z",
    "2025-09-17T02:15:30Z",
    "2026-07-04T05:37:20Z",  # non-hour, non-minute
    "2028-02-29T12:00:00Z",  # leap day
    "2030-12-31T23:00:00Z",  # last ephemeris row
]
WINDOWS = [  # (site, start, days)
    ("im1", "2024-01-19T00:00:00Z", 14),
    ("im1", "2024-02-22T00:00:00Z", 14),
    ("slim", "2024-01-19T00:00:00Z", 14),
    ("im2", "2024-01-01T00:00:00Z", 28),   # has an Earthset (libration at a limb site)
    ("im1", "2026-11-01T00:00:00Z", 28),   # contains a mock Earth-eclipses-Sun event
]
TOLERANCES = {"az_el_deg": 1e-3, "radius_deg": 1e-3, "fraction": 1e-3, "hours": 0.2, "pct": 1.5,
              "event_s": 60}
ROUND = 6


def eclipse_instants(eng: Engine, site_id: str) -> list[str]:
    """Three instants around this site's closest Sun-Earth approach in 2024-2026 (hourly scan):
    mid-totality (minimum on a 1-min grid), mid-partial-only, and 10 min after the partial phase ends
    (searched backwards in time). Chosen away from thresholds so float noise cannot flip the flags."""
    t = parse_utc("2024-01-01T00:00:00Z") + 3600.0 * np.arange(3 * 8784)
    k = int(np.argmin(eng.observe(site_id, t)["sun_earth_sep"]))
    tm = t[k] + 60.0 * np.arange(-240, 241)
    o = eng.observe(site_id, tm)
    j0 = int(np.argmin(o["sun_earth_sep"]))
    out = [tm[j0]]
    part = o["eclipse_partial"] & ~o["eclipse_total"]
    j = j0
    while j > 0 and not part[j]:
        j -= 1
    j_end = j
    while j > 0 and part[j]:
        j -= 1
    out.append(tm[(j + 1 + j_end) // 2])  # middle of the partial-only stretch
    out.append(tm[max(j - 10, 0)])         # 10 min outside the partial phase
    return [fmt_utc(x) for x in out]


def r(x):
    return round(float(x), ROUND)


def build(data_dir=DEFAULT_DATA) -> dict:
    eng = Engine(data_dir)
    instants = []
    for sid in SITES:
        utcs = list(dict.fromkeys(FIXED_INSTANTS + eclipse_instants(eng, sid)))
        o = eng.observe(sid, [parse_utc(u) for u in utcs])
        for j, u in enumerate(utcs):
            instants.append({
                "site_id": sid, "utc": u,
                "sun": {"az": r(o["sun_az"][j]), "el": r(o["sun_el"][j]), "radius": r(o["sun_r"][j]),
                        "fraction": r(o["sun_frac"][j])},
                "earth": {"az": r(o["earth_az"][j]), "el": r(o["earth_el"][j]), "radius": r(o["earth_r"][j]),
                          "fraction": r(o["earth_frac"][j]), "dist_km": round(float(o["earth_dist_km"][j]), 3)},
                "earth_el_geocentric": r(o["earth_el_geocentric"][j]),
                "earth_az_geocentric": r(o["earth_az_geocentric"][j]),
                "sun_earth_sep": r(o["sun_earth_sep"][j]),
                "eclipse_partial": bool(o["eclipse_partial"][j]),
                "eclipse_total": bool(o["eclipse_total"][j]),
            })

    def rm(m):
        out = {k: (r(v) if isinstance(v, float) else v) for k, v in m.items() if k != "band"}
        if "band" in m:
            out["band"] = {b: rm(m["band"][b]) for b in ("lo", "hi")}
        return out

    windows = []
    for sid, start, days in WINDOWS:
        windows.append({"mode": "limb", "days": days,
                        "metrics": rm(eng.window_metrics_with_band(sid, start, days=days, mode="limb"))})
        windows.append({"mode": "centre", "days": days,
                        "metrics": rm(eng.window_metrics(sid, start, days=days, mode="centre"))})

    return {
        "schema": "engine_vectors v1 (see docs/engine-spec.md)",
        "meta": {"ai_generated": True, "generated_by": "tests/reference/make_golden.py", "mock": True},
        "note": ("SYNTHETIC values computed from MOCK data (app/public/data/mock, tools/make_mocks.py) with the "
                 "reference engine tests/reference/engine_ref.py. They check the engine arithmetic only, not "
                 "real astronomy. Regenerate if tools/make_mocks.py or docs/engine-spec.md changes."),
        "data_dir": str(pathlib.Path(data_dir).resolve().relative_to(ROOT)),
        "tolerances": TOLERANCES,
        "instants": instants,
        "windows": windows,
    }


def main():
    data_dir = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DATA
    doc = build(data_dir)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(doc['instants'])} instants, {len(doc['windows'])} windows, "
          f"{OUT.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
