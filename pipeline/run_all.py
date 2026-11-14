# AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
"""Run Agent A's whole pipeline and pack the outputs into one zip.

Steps (each keeps going if an earlier one failed, where that makes sense):
  1. get_kernels.py        download the five NAIF kernels
  2. make_ephem.py         SPICE -> app/public/data/ephem.bin
  3. fetch_horizons.py     JPL Horizons -> fixtures.json, docs/horizons-flags.md
  4. check_vs_horizons.py  residual check, must be within 0.01 deg
  5. make_horizons.py      LOLA horizons with occluders, features.json
  6. make_science_doc.py   docs/science.md
  7. contract tests        python -m pytest -q tests
  8. pack                  pipeline/cache/agent_a_outputs.zip

Usage:
  python pipeline/run_all.py
  python pipeline/run_all.py --dem-dir "C:\\path\\to\\folder\\with\\LOLA\\tifs"
  python pipeline/run_all.py --skip-horizons
"""
import argparse
import subprocess
import sys
import zipfile

import common as C

PACK = ["app/public/data/ephem.bin", "app/public/data/ephem.header.json",
        "app/public/data/fixtures.json", "app/public/data/features.json",
        "docs/science.md", "docs/horizons-flags.md"]


def step(log, title, args):
    print(f"\n== {title} ==", flush=True)
    log.write(f"\n== {title} ==\n")
    proc = subprocess.Popen([sys.executable] + args, cwd=str(C.ROOT), text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for line in proc.stdout:
        if "\r" in line:                       # download progress: keep the last state
            line = line.split("\r")[-1]
        print(line, end="", flush=True)
        log.write(line)
    proc.wait()
    ok = proc.returncode == 0
    msg = f"-> {'ok' if ok else 'FAILED (exit ' + str(proc.returncode) + ')'}"
    print(msg, flush=True)
    log.write(msg + "\n")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dem-dir", action="append", default=[])
    ap.add_argument("--skip-horizons", action="store_true")
    args = ap.parse_args()
    dem_args = [x for d in args.dem_dir for x in ("--dem-dir", d)]

    C.REPORTS.mkdir(parents=True, exist_ok=True)
    log_path = C.REPORTS / "run_log.txt"
    results = {}
    with open(log_path, "w", encoding="utf-8") as log:
        log.write(f"pipeline commit {C.git_sha()}\npython {sys.version}\n")
        results["1 kernels"] = step(log, "1. kernels", ["pipeline/get_kernels.py"])
        results["2 ephem.bin"] = results["1 kernels"] and step(log, "2. ephem.bin (SPICE)", ["pipeline/make_ephem.py"])
        results["3 Horizons fixtures"] = step(log, "3. Horizons fixtures", ["pipeline/fetch_horizons.py"])
        results["4 residual check"] = (results["2 ephem.bin"] and results["3 Horizons fixtures"]
                                       and step(log, "4. residual check", ["pipeline/check_vs_horizons.py"]))
        if args.skip_horizons:
            results["5 horizons"] = None
        else:
            results["5 horizons"] = step(log, "5. terrain horizons", ["pipeline/make_horizons.py"] + dem_args)
        results["6 science doc"] = step(log, "6. docs/science.md", ["pipeline/make_science_doc.py"])
        results["7 contract tests"] = step(log, "7. contract tests", ["-m", "pytest", "-q", "tests"])

        print("\n== summary ==")
        log.write("\n== summary ==\n")
        for name, ok in results.items():
            line = f"{name:22s} {'skipped' if ok is None else 'ok' if ok else 'FAILED or not run'}"
            print(line)
            log.write(line + "\n")

    files = [C.ROOT / p for p in PACK]
    files += sorted((C.DATA / "horizon").glob("*.json")) if (C.DATA / "horizon").exists() else []
    files += sorted(C.REPORTS.glob("*"))
    C.CACHE.mkdir(parents=True, exist_ok=True)       # git-ignored folder
    out = C.CACHE / "agent_a_outputs.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            if f.is_file():
                z.write(f, f.relative_to(C.ROOT).as_posix())
    print(f"\npacked {out} ({out.stat().st_size / 1e6:.2f} MB)")
    print("Attach that zip in the chat and paste the summary above.")


if __name__ == "__main__":
    main()
