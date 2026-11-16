# AI-assisted; see README.
"""Build app/public/data/sites.json from data-src/sites.yaml and validate it. Owner: Agent C.
Usage: python3 tools/build_sites.py
"""
import json, pathlib, subprocess, yaml, jsonschema

ROOT = pathlib.Path(__file__).resolve().parents[1]

def git_sha():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return "uncommitted"

def main():
    src = yaml.safe_load((ROOT / "data-src/sites.yaml").read_text())
    for s in src["sites"]:
        s["lon_e"] = s["lon_e"] % 360.0
    src["meta"]["git_sha"] = git_sha()
    schema = json.loads((ROOT / "contracts/sites.schema.json").read_text())
    jsonschema.validate(src, schema)
    out = ROOT / "app/public/data/sites.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(src, indent=2) + "\n")
    print(f"wrote {out.relative_to(ROOT)} ({len(src['sites'])} sites)")

if __name__ == "__main__":
    main()
