# AI-assisted; see README.
"""Fetch JPL Horizons truth values for the validation fixtures.

For every site with validation_use == "numeric" it asks Horizons for the
apparent, airless azimuth and elevation of the Sun (10) and the Earth (399)
as seen from that point on the Moon (CENTER coord@301, geodetic east
longitude, latitude, altitude in km), at 10 epochs spread over about one
lunar day. Epochs fall on the half hour so the app's hourly interpolation
is exercised.

Writes app/public/data/fixtures.json (contracts/fixtures.schema.json),
docs/horizons-flags.md (verbatim legend from a live reply) and
pipeline/reports/fixtures.json.

API docs: https://ssd-api.jpl.nasa.gov/doc/horizons.html
Usage:  python pipeline/fetch_horizons.py
"""
import datetime
import json
import time
import urllib.parse
import urllib.request

import common as C

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
BODIES = {"sun": "10", "earth": "399"}
N_EPOCHS = 10
STEP_H = 71                       # 10 epochs x 71 h = 26.6 days
TOL_DEG = 0.01
DEFAULT_START = "2026-01-05T00:30:00Z"
# The round-1 epochs were chosen when the ephemeris began in 2024. That date
# stays the rule for them, so the first 140 fixtures keep their epochs now
# that the ephemeris begins in 2023.
BASE_FROM = "2024-01-01T00:00:00Z"
# Extra series: site id -> step in hours, from half past the landing hour.
# chandrayaan3 landed 23 Aug 2023: 10 epochs x 27 h runs to 2 Sep 2023.
EXTRA_STEP_H = {"chandrayaan3": 27}


def ephem_span():
    hdr = json.loads((C.CONTRACTS / "ephem.header.json").read_text())
    t0 = C.parse_utc(hdr["t0_utc"])
    return t0, t0 + datetime.timedelta(seconds=hdr["step_s"] * (hdr["n"] - 1))


def start_epoch(site):
    """Half past the landing hour when the landing is inside the ephemeris
    span, otherwise a fixed default date."""
    t0, t1 = ephem_span()
    t0 = max(t0, C.parse_utc(BASE_FROM))
    span = datetime.timedelta(hours=STEP_H * (N_EPOCHS - 1))
    if site.get("landing_utc"):
        t = C.parse_utc(site["landing_utc"]).replace(minute=30, second=0, microsecond=0)
        if t0 + datetime.timedelta(hours=1) <= t and t + span <= t1 - datetime.timedelta(hours=1):
            return t
    return C.parse_utc(DEFAULT_START)


def series(site):
    """(start, step_h) for every fixture series of a site."""
    out = [(start_epoch(site), STEP_H)]
    step = EXTRA_STEP_H.get(site["id"])
    if step and site.get("landing_utc"):
        t0, t1 = ephem_span()
        t = C.parse_utc(site["landing_utc"]).replace(minute=30, second=0, microsecond=0)
        end = t + datetime.timedelta(hours=step * (N_EPOCHS - 1))
        if t0 + datetime.timedelta(hours=1) <= t and end <= t1 - datetime.timedelta(hours=1) \
                and t != out[0][0]:
            out.append((t, step))
    return out


def query_url(body, site, start, step_h=STEP_H):
    stop = start + datetime.timedelta(hours=step_h * (N_EPOCHS - 1))
    fmt = "%Y-%m-%d %H:%M"
    params = {
        "format": "text",
        "COMMAND": f"'{BODIES[body]}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{site['lon_e']:.6f},{site['lat']:.6f},{C.site_elev_km(site):.4f}'",
        "START_TIME": f"'{start.strftime(fmt)}'",
        "STOP_TIME": f"'{stop.strftime(fmt)}'",
        "STEP_SIZE": f"'{step_h} h'",
        "QUANTITIES": "'4'",
        "APPARENT": "'AIRLESS'",
        "CSV_FORMAT": "'YES'",
        "CAL_FORMAT": "'JD'",
    }
    return API + "?" + urllib.parse.urlencode(params)


def parse_reply(text):
    """Rows of (jd, az, el, marker1, marker2) from a Horizons CSV reply."""
    lines = text.splitlines()
    try:
        soe = next(i for i, l in enumerate(lines) if l.strip() == "$$SOE")
        eoe = next(i for i, l in enumerate(lines) if l.strip() == "$$EOE")
    except StopIteration:
        raise ValueError("no $$SOE/$$EOE table in the Horizons reply")
    header = None
    for i in range(soe - 1, max(soe - 12, -1), -1):
        if "Azi" in lines[i]:
            header = [c.strip() for c in lines[i].split(",")]
            break
    if header is None:
        raise ValueError("no azimuth column in the Horizons reply")
    az_cols = [i for i, c in enumerate(header) if "Azi" in c]
    el_cols = [i for i, c in enumerate(header) if "Elev" in c and i not in az_cols]
    pick = lambda cols: next((i for i in cols if "a-app" in header[i]), cols[0])
    az_i = pick(az_cols)
    el_i = pick(el_cols) if el_cols else az_i + 1
    rows = []
    for line in lines[soe + 1:eoe]:
        cells = [c.strip() for c in line.split(",")]
        if len(cells) <= max(az_i, el_i):
            continue
        rows.append((float(cells[0]), float(cells[az_i]), float(cells[el_i]),
                     cells[1] if az_i > 1 else "", cells[2] if az_i > 2 else ""))
    return rows, lines[:soe], lines[eoe + 1:]


def write_flags_doc(url, head, foot, markers):
    """docs/horizons-flags.md: the reply's own words, quoted verbatim."""
    out = [
        "# Horizons output flags for a lunar surface observer",
        "",
        "<!-- AI-ASSISTED: generated by pipeline/fetch_horizons.py from a live JPL "
        "Horizons reply. The quoted blocks are verbatim; nothing here is inferred. -->",
        "",
        "Query used (Sun as seen from the first numeric site):",
        "",
        "```", url, "```",
        "",
        "## Marker values that actually appeared in the data rows",
        "",
        "Two marker columns follow the date in every row. Distinct values seen "
        "across all fixture queries (an empty string means a blank column):",
        "",
    ]
    for body, cols in sorted(markers.items()):
        out.append(f"- {body}: column 1 = {sorted(cols[0])}, column 2 = {sorted(cols[1])}")
    out += ["", "## Reply header, verbatim", "", "```"] + head[-60:] + ["```", "",
            "## Reply legend after the table, verbatim", "", "```"] + foot[:140] + ["```", ""]
    C.DOCS.mkdir(exist_ok=True)
    (C.DOCS / "horizons-flags.md").write_text("\n".join(out), encoding="utf-8")


def main():
    sites = [s for s in C.load_sites() if s.get("validation_use") == "numeric"]
    fixtures, report, markers = [], [], {}
    sample = None
    for site, (start, step_h) in [(s_, x) for s_ in sites for x in series(s_)]:
        for body in BODIES:
            url = query_url(body, site, start, step_h)
            with urllib.request.urlopen(url, timeout=120) as resp:
                text = resp.read().decode("utf-8", "replace")
            try:
                rows, head, foot = parse_reply(text)
            except ValueError as err:
                dump = C.CACHE / f"horizons_raw_{site['id']}_{body}.txt"
                dump.parent.mkdir(parents=True, exist_ok=True)
                dump.write_text(text, encoding="utf-8")
                raise SystemExit(f"STOPPED at {site['id']} {body}: {err}. Reply "
                                 f"saved to {dump}; send its first 60 lines.")
            if sample is None:
                sample = (url, head, foot)
                C.CACHE.mkdir(parents=True, exist_ok=True)
                (C.CACHE / "horizons_sample.txt").write_text(text, encoding="utf-8")
            m = markers.setdefault(body, (set(), set()))
            for jd, az, el, m1, m2 in rows:
                m[0].add(m1); m[1].add(m2)
                fixtures.append({"site_id": site["id"], "utc": C.iso_z(C.jd_to_utc(jd)),
                                 "body": body, "horizons_az": az, "horizons_el": el,
                                 "tol_deg": TOL_DEG, "query_url": url})
            report.append({"site_id": site["id"], "body": body, "rows": len(rows),
                           "start_utc": C.iso_z(start), "step_h": step_h,
                           "alt_km_sent": round(C.site_elev_km(site), 4),
                           "catalog_elev_missing": site.get("elev_m") is None})
            print(f"{site['id']:14s} {body:5s} {len(rows):2d} epochs from {C.iso_z(start)}, step {step_h} h")
            time.sleep(0.5)
    C.write_json(C.DATA / "fixtures.json",
                 {"schema_version": 1, "fixtures": fixtures,
                  "meta": C.meta("pipeline/fetch_horizons.py")}, indent=1)
    C.write_json(C.REPORTS / "fixtures.json", {"queries": report,
                 "n_fixtures": len(fixtures), "tol_deg": TOL_DEG}, indent=2)
    if sample:
        write_flags_doc(sample[0], sample[1], sample[2], markers)
    print(f"{len(fixtures)} fixtures -> app/public/data/fixtures.json")
    print("legend quoted in docs/horizons-flags.md")


if __name__ == "__main__":
    main()
