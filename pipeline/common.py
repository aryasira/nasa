# AI-assisted; see README.
"""Shared helpers for Agent A's pipeline (paths, metadata, geometry, downloads).

Conventions (CONTEXT.md section 5): MOON_ME body-fixed frame, east longitude
0-360, azimuth clockwise from north, elevation above the plane normal to the
reference sphere, UTC ISO-8601 with Z.
"""
import datetime
import json
import math
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PIPE = ROOT / "pipeline"
DATA = ROOT / "app" / "public" / "data"
CONTRACTS = ROOT / "contracts"
KERNELS = PIPE / "kernels"      # git-ignored
CACHE = PIPE / "cache"          # git-ignored
REPORTS = PIPE / "reports"      # small JSON reports, committed
DOCS = ROOT / "docs"

MOON_R_KM = 1737.4
AU_KM = 149597870.7
UTC = datetime.timezone.utc


def git_sha():
    """Commit of this checkout. Works in a git clone and in a GitHub zip."""
    try:
        out = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=10)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    stamp = PIPE / "VERSION"    # filled by `git archive` (export-subst)
    if stamp.exists():
        text = stamp.read_text().strip()
        if text and not text.startswith("$Format"):
            return text
    return "unknown"


def meta(generated_by):
    return {"ai_generated": True, "generated_by": generated_by,
            "git_sha": git_sha(), "mock": False}


def load_sites():
    return json.loads((DATA / "sites.json").read_text(encoding="utf-8"))["sites"]


def write_json(path, doc, indent=None, generated_by=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(doc, dict) and "meta" not in doc:
        # Team rule: every JSON output carries a meta block.
        doc = dict(doc, meta=meta(generated_by or "pipeline/" + path.stem))
    path.write_text(json.dumps(doc, indent=indent) + "\n", encoding="utf-8")


def read_report(name, default=None):
    p = REPORTS / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def fetch(url, dest):
    """Download url to dest (skips if present). Returns size in bytes."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        print(f"have  {dest.name} ({dest.stat().st_size} bytes)")
        return dest.stat().st_size
    print(f"get   {url}")
    tmp = dest.with_name(dest.name + ".part")

    def progress(blocks, block_size, total):
        if total > 0:
            pct = min(100, blocks * block_size * 100 // total)
            sys.stdout.write(f"\r      {pct:3d}% of {total / 1e6:.1f} MB")
            sys.stdout.flush()

    try:
        urllib.request.urlretrieve(url, tmp, progress)
    except urllib.error.HTTPError as err:
        raise RuntimeError(
            f"HTTP {err.code} for {url}. Open the folder "
            f"{url.rsplit('/', 1)[0]}/ in a browser, find {dest.name}, and "
            f"save it by hand as {dest}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"could not reach {url}: {err.reason}. Download it "
                           f"by hand and save it as {dest}") from err
    tmp.replace(dest)
    print()
    return dest.stat().st_size


# ---- time ----
def parse_utc(text):
    return datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)


def iso_z(dt):
    """ISO-8601 with Z, rounded to the nearest second."""
    dt = dt.astimezone(UTC) + datetime.timedelta(milliseconds=500)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def jd_to_utc(jd):
    """Julian date (UT) to a datetime, rounded to the millisecond."""
    seconds = round((jd - 2440587.5) * 86400.0, 3)
    return datetime.datetime(1970, 1, 1, tzinfo=UTC) + datetime.timedelta(seconds=seconds)


# ---- geometry (plain Python, used by the checks) ----
def unit(lat_deg, lon_deg):
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def normalize(v):
    n = math.sqrt(dot(v, v))
    return (v[0] / n, v[1] / n, v[2] / n)


def local_frame(lat_deg, lon_deg):
    """(up, east, north) unit vectors in the body-fixed frame."""
    up = unit(lat_deg, lon_deg)
    east = normalize(cross((0.0, 0.0, 1.0), up))
    return up, east, cross(up, east)


def az_el(direction, frame):
    """Azimuth (deg clockwise from north) and elevation (deg) of a vector."""
    up, east, north = frame
    d = normalize(direction)
    el = math.degrees(math.asin(max(-1.0, min(1.0, dot(d, up)))))
    az = math.degrees(math.atan2(dot(d, east), dot(d, north))) % 360.0
    return az, el


def site_elev_km(site):
    """Catalogue elevation in km; 0 when the catalogue has none."""
    return (site.get("elev_m") or 0.0) / 1000.0


def site_vector_km(site):
    r = MOON_R_KM + site_elev_km(site)
    u = unit(site["lat"], site["lon_e"])
    return (r * u[0], r * u[1], r * u[2])


def angle_between_deg(a, b):
    a, b = normalize(a), normalize(b)
    c = cross(a, b)
    return math.degrees(math.atan2(math.sqrt(dot(c, c)), dot(a, b)))
