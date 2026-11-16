# AI-assisted; see README.
"""Independent Python reference implementation of docs/engine-spec.md.

Purpose: cross-check Agent B's TypeScript engine (app/src/engine) via golden vectors
(tests/golden/engine_vectors.json, written by tests/reference/make_golden.py).
This file follows the spec literally; if the two disagree, fix the spec first, then both.

Usage:
    from engine_ref import Engine
    eng = Engine()                      # default data dir: app/public/data/mock
    eng.observe("im1", [parse_utc("2024-02-22T23:24:00Z")])
    eng.window_metrics("im1", "2024-01-19T00:00:00Z", days=14)
"""
from __future__ import annotations

import json
import math
import pathlib
from datetime import datetime, timezone

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_DATA = ROOT / "app/public/data/mock"

# ---- constants (spec section 1) ----
R_MOON_KM = 1737.4
R_EARTH_KM = 6378.137
SUN_RADIUS_1AU_DEG = 0.2666
AZ_STEP_DEG = 0.5
N_AZ = 720
STEP_S = 600  # metrics grid, 10 min
BISECT_TOL_S = 1.0


# ---- time ----
def parse_utc(s: str) -> float:
    """ISO-8601 UTC string with 'Z' -> POSIX seconds (float)."""
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()


def fmt_utc(t: float) -> str:
    """POSIX seconds -> 'YYYY-MM-DDTHH:MM:SSZ', rounded to the nearest whole second (half up)."""
    return datetime.fromtimestamp(math.floor(t + 0.5), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---- ephemeris (spec section 2) ----
class Ephem:
    def __init__(self, data_dir: pathlib.Path):
        self.header = json.loads((data_dir / "ephem.header.json").read_text())
        h = self.header
        assert h["dtype"] == "float32" and h["endianness"] == "little" and h["record_bytes"] == 28
        raw = np.frombuffer((data_dir / "ephem.bin").read_bytes(), dtype="<f4")
        assert raw.size == h["n"] * 7, "ephem.bin size != n*7 float32"
        self.rows = raw.reshape(h["n"], 7).astype(np.float64)  # widen BEFORE interpolating
        self.n = h["n"]
        self.step_s = float(h["step_s"])
        self.t0 = parse_utc(h["t0_utc"])
        self.t_last = self.t0 + (self.n - 1) * self.step_s

    def sample(self, t):
        """t: POSIX seconds (scalar or array). Returns (sun_u[k,3], sun_au[k], earth_km[k,3])."""
        t = np.atleast_1d(np.asarray(t, dtype=np.float64))
        if np.any(t < self.t0) or np.any(t > self.t_last):
            raise ValueError("time outside ephemeris coverage")
        f = (t - self.t0) / self.step_s
        i = np.minimum(np.floor(f).astype(np.int64), self.n - 2)
        w = (f - i)[:, None]
        r = (1.0 - w) * self.rows[i] + w * self.rows[i + 1]
        sun = r[:, 0:3]
        sun = sun / np.linalg.norm(sun, axis=1, keepdims=True)  # renormalise
        return sun, r[:, 3], r[:, 4:7]


# ---- geometry (spec section 3) ----
def site_vector(lat_deg: float, lon_e_deg: float, elev_m) -> np.ndarray:
    R = R_MOON_KM + (0.0 if elev_m is None else elev_m) / 1000.0
    la, lo = math.radians(lat_deg), math.radians(lon_e_deg)
    return R * np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


def enu_basis(lat_deg: float, lon_e_deg: float):
    la, lo = math.radians(lat_deg), math.radians(lon_e_deg)
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    return east, north, up


def az_el(d: np.ndarray, basis):
    """d[k,3] direction vectors (any length) -> (az_deg in [0,360), el_deg)."""
    east, north, up = basis
    e, n, u = d @ east, d @ north, d @ up
    az = np.degrees(np.arctan2(e, n)) % 360.0
    az = np.where(az >= 360.0, az - 360.0, az)
    el = np.degrees(np.arctan2(u, np.hypot(e, n)))
    return az, el


def sep_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Angle between row vectors a[k,3], b[k,3] in degrees (atan2 form, accurate at small angles)."""
    return np.degrees(np.arctan2(np.linalg.norm(np.cross(a, b), axis=1), np.sum(a * b, axis=1)))


# ---- horizon + visibility (spec section 4) ----
def horizon_at(elev_deg, az_deg) -> np.ndarray:
    h = np.asarray(elev_deg, dtype=np.float64)
    assert h.size == N_AZ
    x = np.asarray(az_deg, dtype=np.float64) / AZ_STEP_DEG
    fl = np.floor(x)
    w = x - fl
    i0 = fl.astype(np.int64) % N_AZ
    i1 = (i0 + 1) % N_AZ
    return (1.0 - w) * h[i0] + w * h[i1]


def disc_fraction(el_deg, r_deg, h_deg) -> np.ndarray:
    return np.clip((el_deg + r_deg - h_deg) / (2.0 * r_deg), 0.0, 1.0)


def is_visible(frac, mode: str = "limb"):
    if mode == "limb":
        return frac > 0.0
    if mode == "centre":
        return frac >= 0.5
    raise ValueError(mode)


# ---- engine ----
class Engine:
    def __init__(self, data_dir=DEFAULT_DATA):
        self.data_dir = pathlib.Path(data_dir)
        self.ephem = Ephem(self.data_dir)
        sites = json.loads((self.data_dir / "sites.json").read_text())["sites"]
        self.sites = {s["id"]: s for s in sites}
        self._hz = {}

    def horizon(self, site_id: str) -> dict:
        if site_id not in self._hz:
            self._hz[site_id] = json.loads((self.data_dir / "horizon" / f"{site_id}.json").read_text())
        return self._hz[site_id]

    def observe(self, site_id: str, t, horizon_key: str = "elev_deg") -> dict:
        """Everything the spec defines at instants t (POSIX s). Returns dict of numpy arrays."""
        s = self.sites[site_id]
        hz = self.horizon(site_id)[horizon_key]
        basis = enu_basis(s["lat"], s["lon_e"])
        site = site_vector(s["lat"], s["lon_e"], s["elev_m"])
        sun_u, sun_au, earth_km = self.ephem.sample(t)

        sun_az, sun_el = az_el(sun_u, basis)  # Sun at infinity: unit vector as is
        sun_r = SUN_RADIUS_1AU_DEG / sun_au
        sun_f = disc_fraction(sun_el, sun_r, horizon_at(hz, sun_az))

        earth_topo = earth_km - site[None, :]
        dist = np.linalg.norm(earth_topo, axis=1)
        earth_az, earth_el = az_el(earth_topo, basis)
        earth_r = np.degrees(np.arcsin(R_EARTH_KM / dist))
        earth_f = disc_fraction(earth_el, earth_r, horizon_at(hz, earth_az))
        earth_az_geo, earth_el_geo = az_el(earth_km, basis)

        sep = sep_deg(sun_u, earth_topo)
        return {
            "sun_az": sun_az, "sun_el": sun_el, "sun_r": sun_r, "sun_frac": sun_f,
            "earth_az": earth_az, "earth_el": earth_el, "earth_r": earth_r, "earth_frac": earth_f,
            "earth_dist_km": dist,
            "earth_az_geocentric": earth_az_geo, "earth_el_geocentric": earth_el_geo,
            "sun_earth_sep": sep,
            "eclipse_partial": sep < earth_r + sun_r,
            "eclipse_total": sep < earth_r - sun_r,
        }

    # ---- metrics (spec section 5) ----
    def _vis(self, site_id, t, body, mode, horizon_key):
        o = self.observe(site_id, t, horizon_key)
        return is_visible(o[f"{body}_frac"], mode)

    def _next_set(self, site_id, grid, vis, body, mode, horizon_key):
        """grid: N+1 instants incl. window end; vis: visibility on grid."""
        idx = np.nonzero(vis[:-1] & ~vis[1:])[0]
        if idx.size == 0:
            return None
        k = int(idx[0])
        lo, hi = float(grid[k]), float(grid[k + 1])
        while hi - lo > BISECT_TOL_S:
            mid = 0.5 * (lo + hi)
            if self._vis(site_id, mid, body, mode, horizon_key)[0]:
                lo = mid
            else:
                hi = mid
        return fmt_utc(hi)

    def window_metrics(self, site_id, start_utc, days=None, end_utc=None, mode="limb",
                       horizon_key="elev_deg", step_s=STEP_S) -> dict:
        t_start = parse_utc(start_utc)
        t_end = parse_utc(end_utc) if end_utc else t_start + days * 86400.0
        N = int(round((t_end - t_start) / step_s))
        grid = t_start + step_s * np.arange(N + 1, dtype=np.float64)  # k = 0..N (N = end)
        o = self.observe(site_id, grid, horizon_key)
        sun_v = is_visible(o["sun_frac"], mode)
        earth_v = is_visible(o["earth_frac"], mode)
        ecl = o["eclipse_partial"] & sun_v
        S, E, B, X = sun_v[:N], earth_v[:N], (sun_v & earth_v)[:N], ecl[:N]  # left-Riemann samples
        dt_h = step_s / 3600.0

        longest = run = 0
        for v in S:
            run = 0 if v else run + 1
            longest = max(longest, run)

        return {
            "site_id": site_id,
            "start_utc": fmt_utc(t_start),
            "end_utc": fmt_utc(t_end),
            "sunlit_h": float(S.sum() * dt_h),
            "earth_visible_pct": float(100.0 * E.sum() / N),
            "both_visible_h": float(B.sum() * dt_h),
            "longest_dark_gap_h": float(longest * dt_h),
            "next_sunset_utc": self._next_set(site_id, grid, sun_v, "sun", mode, horizon_key),
            "next_earthset_utc": self._next_set(site_id, grid, earth_v, "earth", mode, horizon_key),
            "eclipse_h": float(X.sum() * dt_h),
        }

    def window_metrics_with_band(self, site_id, start_utc, days=None, end_utc=None, mode="limb") -> dict:
        m = self.window_metrics(site_id, start_utc, days, end_utc, mode, "elev_deg")
        m["band"] = {
            "lo": self.window_metrics(site_id, start_utc, days, end_utc, mode, "elev_lo_deg"),
            "hi": self.window_metrics(site_id, start_utc, days, end_utc, mode, "elev_hi_deg"),
        }
        return m
