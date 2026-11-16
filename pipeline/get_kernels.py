# AI-assisted; see README.
"""Download the five NAIF SPICE kernels named in contracts/ephem.header.json.

Saves them in pipeline/kernels/ (git-ignored) and records each file's URL,
byte size and SHA-256 in pipeline/reports/kernels.json.

Usage:  python pipeline/get_kernels.py
"""
import hashlib
import json

import common as C

NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"
URLS = {
    "naif0012.tls": f"{NAIF}/lsk/naif0012.tls",
    "pck00011.tpc": f"{NAIF}/pck/pck00011.tpc",
    "moon_pa_de440_200625.bpc": f"{NAIF}/pck/moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf": f"{NAIF}/fk/satellites/moon_de440_250416.tf",
    "de440s.bsp": f"{NAIF}/spk/planets/de440s.bsp",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    wanted = json.loads((C.CONTRACTS / "ephem.header.json").read_text())["kernels"]
    missing = [k for k in wanted if k not in URLS]
    if missing:
        raise SystemExit(f"no download URL known for {missing}")
    rows, problems = [], []
    for name in wanted:
        try:
            C.fetch(URLS[name], C.KERNELS / name)
        except RuntimeError as err:
            problems.append(str(err))
            continue
        path = C.KERNELS / name
        rows.append({"name": name, "url": URLS[name],
                     "bytes": path.stat().st_size, "sha256": sha256(path)})
    C.write_json(C.REPORTS / "kernels.json", {"kernels": rows}, indent=2)
    for r in rows:
        print(f"{r['name']:28s} {r['bytes']:>12d} bytes")
    if problems:
        raise SystemExit("KERNELS INCOMPLETE:\n" + "\n".join(problems))
    print("all kernels present")


if __name__ == "__main__":
    main()
