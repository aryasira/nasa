# AI-assisted; see README.
"""Write app/public/data/ephem.bin and ephem.header.json with SPICE.

Hourly Sun and Earth vectors as seen from the Moon's centre, in the
body-fixed MOON_ME frame, aberration correction LT+S, exactly as laid out
in contracts/ephem.header.json:

    sun_ux, sun_uy, sun_uz   unit vector Moon centre -> Sun
    sun_au                   Sun distance in AU
    earth_x_km .. earth_z_km Earth POSITION in km (the app subtracts the site)

Needs the kernels from get_kernels.py.   Usage:  python pipeline/make_ephem.py
"""
import json
import os

import numpy as np

import common as C

TEXT_KERNELS = (".tls", ".tpc", ".tf")


def load_kernels(spice, names):
    """furnsh every kernel. Text kernels get a native-line-ending copy if
    the toolkit refuses the downloaded file (an old Windows CSPICE issue)."""
    for name in names:
        path = C.KERNELS / name
        if not path.exists():
            raise SystemExit(f"missing kernel {path}. Run pipeline/get_kernels.py")
        try:
            spice.furnsh(str(path))
        except Exception as err:      # spiceypy raises SpiceyError subclasses
            if not name.lower().endswith(TEXT_KERNELS):
                raise
            native = C.KERNELS / "_native" / name
            native.parent.mkdir(exist_ok=True)
            text = path.read_bytes().replace(b"\r\n", b"\n").replace(
                b"\n", os.linesep.encode())
            native.write_bytes(text)
            print(f"note: {name} reloaded with native line endings ({err})")
            spice.furnsh(str(native))


def records(sun_km, earth_km):
    """(n,7) little-endian float32 rows from Sun and Earth position arrays."""
    sun_km = np.asarray(sun_km, dtype="float64")
    earth_km = np.asarray(earth_km, dtype="float64")
    dist = np.linalg.norm(sun_km, axis=1)
    rec = np.column_stack([sun_km / dist[:, None], dist / C.AU_KM, earth_km])
    return rec.astype("<f4")


def summarize(rec):
    """Libration and distance ranges, computed from the vectors themselves."""
    sun, earth = rec[:, :3].astype("float64"), rec[:, 4:7].astype("float64")
    ed = np.linalg.norm(earth, axis=1)
    eu = earth / ed[:, None]
    elon = np.degrees(np.arctan2(eu[:, 1], eu[:, 0]))
    return {
        "rows": int(rec.shape[0]),
        "sun_lat_deg": [float(np.degrees(np.arcsin(sun[:, 2])).min()),
                        float(np.degrees(np.arcsin(sun[:, 2])).max())],
        "sun_au": [float(rec[:, 3].min()), float(rec[:, 3].max())],
        "earth_lat_deg": [float(np.degrees(np.arcsin(eu[:, 2])).min()),
                          float(np.degrees(np.arcsin(eu[:, 2])).max())],
        "earth_lon_deg": [float(elon.min()), float(elon.max())],
        "earth_km": [float(ed.min()), float(ed.max())],
    }


def main():
    import spiceypy as spice

    hdr = json.loads((C.CONTRACTS / "ephem.header.json").read_text())
    n, step = hdr["n"], hdr["step_s"]
    spice.kclear()
    load_kernels(spice, hdr["kernels"])

    t0 = hdr["t0_utc"].rstrip("Z")
    et = spice.str2et(t0) + float(step) * np.arange(n)
    # hourly UTC equals hourly ET only while no leap second falls in the span
    last = C.iso_z(C.parse_utc(hdr["t0_utc"]) + (n - 1) * C.datetime.timedelta(
        seconds=step)).rstrip("Z")
    drift = abs(spice.str2et(last) - et[-1])
    if drift > 0.01:
        raise SystemExit(f"UTC/ET drift {drift:.3f} s over the span: a leap "
                         "second is inside it; compute each epoch with str2et")

    frame, abcorr = hdr["frame"], hdr["abcorr"]
    sun, _ = spice.spkpos("SUN", et, frame, abcorr, "MOON")
    earth, _ = spice.spkpos("EARTH", et, frame, abcorr, "MOON")
    rec = records(sun, earth)
    assert rec.shape == (n, 7) and rec.dtype.itemsize * 7 == hdr["record_bytes"]

    C.DATA.mkdir(parents=True, exist_ok=True)
    (C.DATA / "ephem.bin").write_bytes(rec.tobytes())
    kern = C.read_report("kernels.json", {"kernels": []})["kernels"]
    hdr["$comment"] = ("AI-ASSISTED. Real ephemeris written by "
                       "pipeline/make_ephem.py. Layout per contracts/ephem.header.json.")
    hdr["spice_version"] = f"{spice.tkvrsn('TOOLKIT')} via spiceypy {spice.__version__}"
    hdr["kernel_files"] = kern
    hdr["meta"] = C.meta("pipeline/make_ephem.py")
    C.write_json(C.DATA / "ephem.header.json", hdr, indent=2)

    stats = summarize(rec)
    stats["spice_version"] = hdr["spice_version"]
    stats["bytes"] = (C.DATA / "ephem.bin").stat().st_size
    stats["first_row"] = [float(v) for v in rec[0]]
    C.write_json(C.REPORTS / "ephem.json", stats, indent=2)
    print(f"ephem.bin {stats['bytes']} bytes, {n} rows, {hdr['spice_version']}")
    print(f"sun latitude {stats['sun_lat_deg'][0]:.3f} to {stats['sun_lat_deg'][1]:.3f} deg, "
          f"distance {stats['sun_au'][0]:.4f} to {stats['sun_au'][1]:.4f} AU")
    print(f"earth libration lat {stats['earth_lat_deg'][0]:.3f} to {stats['earth_lat_deg'][1]:.3f}, "
          f"lon {stats['earth_lon_deg'][0]:.3f} to {stats['earth_lon_deg'][1]:.3f} deg")
    print(f"earth distance {stats['earth_km'][0]:.0f} to {stats['earth_km'][1]:.0f} km")


if __name__ == "__main__":
    main()
