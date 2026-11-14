# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Self-check: ephem.bin against the JPL Horizons fixtures.

Recomputes topocentric azimuth and elevation the way the app must:
  1. interpolate ephem.bin linearly between hourly rows,
  2. renormalise the Sun unit vector,
  3. Earth direction = earth_km - site_km  (topocentric),
  4. rotate into the local east/north/up frame of the site.

Acceptance (AGENT-A brief): every fixture within its tol_deg (0.01 deg) in
both azimuth and elevation. Azimuth gaps are scaled by cos(elevation).
Also reports the angle between the geocentric and topocentric Earth
directions, which shows the parallax the app must not skip.

Writes pipeline/reports/residuals.json. Exit code 1 if any fixture fails.
Usage:  python pipeline/check_vs_horizons.py
"""
import json
import math
import sys

import numpy as np

import common as C


def load_ephem(data_dir=None):
    data_dir = data_dir or C.DATA
    hdr = json.loads((data_dir / "ephem.header.json").read_text())
    rec = np.frombuffer((data_dir / "ephem.bin").read_bytes(), dtype="<f4")
    return hdr, rec.reshape(-1, 7).astype("float64")


def vectors_at(hdr, rec, utc):
    """Sun unit vector and Earth position (km) at a UTC time."""
    x = (C.parse_utc(utc) - C.parse_utc(hdr["t0_utc"])).total_seconds() / hdr["step_s"]
    i = int(math.floor(x))
    if i < 0 or i >= len(rec) - 1:
        raise ValueError(f"{utc} is outside the ephemeris span")
    f = x - i
    row = rec[i] * (1 - f) + rec[i + 1] * f
    return C.normalize(tuple(row[:3])), tuple(row[4:7])


def app_angles(hdr, rec, site, utc):
    """((sun_az, sun_el), (earth_az, earth_el), parallax_deg)."""
    sun, earth = vectors_at(hdr, rec, utc)
    frame = C.local_frame(site["lat"], site["lon_e"])
    sv = C.site_vector_km(site)
    topo = (earth[0] - sv[0], earth[1] - sv[1], earth[2] - sv[2])
    return C.az_el(sun, frame), C.az_el(topo, frame), C.angle_between_deg(earth, topo)


def run(data_dir=None, sites=None):
    hdr, rec = load_ephem(data_dir)
    fixtures = json.loads(((data_dir or C.DATA) / "fixtures.json").read_text())["fixtures"]
    sites = {s["id"]: s for s in (sites or C.load_sites())}
    table, failures, worst_par = {}, [], 0.0
    for fx in fixtures:
        site = sites[fx["site_id"]]
        sun, earth, par = app_angles(hdr, rec, site, fx["utc"])
        az, el = sun if fx["body"] == "sun" else earth
        d_az = abs((az - fx["horizons_az"] + 180.0) % 360.0 - 180.0)
        d_az *= math.cos(math.radians(fx["horizons_el"]))
        d_el = abs(el - fx["horizons_el"])
        row = table.setdefault((fx["site_id"], fx["body"]), {"n": 0, "az": 0.0, "el": 0.0})
        row["n"] += 1
        row["az"], row["el"] = max(row["az"], d_az), max(row["el"], d_el)
        if fx["body"] == "earth":
            worst_par = max(worst_par, par)
        if max(d_az, d_el) > fx["tol_deg"]:
            failures.append({"site_id": fx["site_id"], "body": fx["body"],
                             "utc": fx["utc"], "d_az": d_az, "d_el": d_el})
    rows = [{"site_id": k[0], "body": k[1], "n": v["n"],
             "max_az_gap_deg": round(v["az"], 5), "max_el_gap_deg": round(v["el"], 5)}
            for k, v in sorted(table.items())]
    report = {"rows": rows, "n_fixtures": len(fixtures), "n_failures": len(failures),
              "failures": failures[:20], "tol_deg": max((f["tol_deg"] for f in fixtures), default=None),
              "max_earth_parallax_deg": round(worst_par, 4),
              "parallax_upper_bound_deg": round(math.degrees(math.asin(C.MOON_R_KM / 356400.0)), 4),
              "passed": not failures and bool(fixtures)}
    return report


def main():
    report = run()
    C.write_json(C.REPORTS / "residuals.json", report, indent=2)
    print(f"{'site':14s} {'body':5s}  n  max az gap  max el gap  (deg, az scaled by cos el)")
    for r in report["rows"]:
        print(f"{r['site_id']:14s} {r['body']:5s} {r['n']:2d}   {r['max_az_gap_deg']:8.5f}    {r['max_el_gap_deg']:8.5f}")
    print(f"Earth parallax actually applied: up to {report['max_earth_parallax_deg']:.4f} deg "
          f"(geometric ceiling {report['parallax_upper_bound_deg']:.4f} deg)")
    if report["passed"]:
        print(f"PASS: all {report['n_fixtures']} fixtures within {report['tol_deg']} deg")
    else:
        print(f"FAIL: {report['n_failures']} of {report['n_fixtures']} fixtures outside tolerance")
        for f in report["failures"][:8]:
            print(f"  {f['site_id']} {f['body']} {f['utc']}: az {f['d_az']:.4f} el {f['d_el']:.4f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
