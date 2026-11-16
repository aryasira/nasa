# AI-assisted; see README.
"""Terrain horizon by ray marching, with occluder attribution.

For each azimuth a great-circle ray leaves the observer. At each sample the
terrain height is read from the finest DEM that covers it, and the elevation
angle of that terrain point is computed on a spherical Moon:

    elev = atan2(r1*cos(theta) - r0, r1*sin(theta))
    r0 = R + site height + mast,  r1 = R + terrain height,  theta = distance/R

The horizon is the largest angle along the ray. The sample that wins (the
argmax) is the occluder: its distance, latitude and east longitude are kept
so the app can say what blocks the Sun or the Earth.

Beyond the DEM coverage the terrain is assumed to sit at the reference
sphere. Where no real terrain rises above that assumed surface, the horizon
is the sphere's limb and the occluder is null.

Uncertainty band (optional): each DEM can come with its published per-pixel
height error map. The band is the horizon recomputed with every terrain cell
raised by its error and the observer lowered by the error at the site (upper
edge), and the reverse (lower edge). It is an envelope from the published
errors. It does not include the error from the grid spacing itself.

Heights are metres above the DEM's reference sphere (1737.4 km for the LOLA
products). Azimuth is clockwise from north. Frame: the DEM's body-fixed frame
(MOON_ME, DE421, for the NASA GSFC PGDA LOLA products).
"""
import math
import pathlib
import warnings

import numpy as np
import pyproj
import rasterio
import rasterio.errors
from rasterio.enums import Resampling
from rasterio.windows import Window, from_bounds
from scipy.ndimage import map_coordinates


class Dem:
    """A window of a DEM around a site, held in memory."""

    def __init__(self, path, lon, lat, radius_m, max_px=6000):
        self.path = pathlib.Path(path)
        with rasterio.open(path) as ds:
            self.crs = pyproj.CRS.from_wkt(ds.crs.to_wkt())
            self.radius = self.crs.ellipsoid.semi_major_metre
            self.fwd = pyproj.Transformer.from_crs(self.crs.geodetic_crs, self.crs,
                                                   always_xy=True)
            cx, cy = self.fwd.transform(lon, lat)
            win = from_bounds(cx - radius_m, cy - radius_m, cx + radius_m,
                              cy + radius_m, ds.transform)
            try:
                win = win.intersection(Window(0, 0, ds.width, ds.height))
            except rasterio.errors.WindowError:
                raise ValueError(f"{self.path.name}: the site is outside this DEM")
            win = win.round_offsets().round_lengths()
            if win.width < 2 or win.height < 2:
                raise ValueError(f"{self.path.name}: the site is outside this DEM")
            f = max(1, math.ceil(max(win.width, win.height) / max_px))
            shape = (int(win.height // f), int(win.width // f))
            z = ds.read(1, window=win, out_shape=shape,
                        resampling=Resampling.average, masked=True)
            z = z.astype("float64").filled(np.nan)
            scale = ds.scales[0] if ds.scales else 1.0
            offset = ds.offsets[0] if ds.offsets else 0.0
            if (scale, offset) != (1.0, 0.0):
                z = z * scale + offset
            z[np.abs(z) > 30000.0] = np.nan          # fill values
            if not np.isfinite(z).any():
                raise ValueError(f"{self.path.name}: no valid heights near the site")
            self.z = z
            wt = ds.window_transform(win)
            fx, fy = win.width / shape[1], win.height / shape[0]
            # the window's affine transform with its pixel size scaled
            self.gt = (wt.a * fx, wt.b * fy, wt.c, wt.d * fx, wt.e * fy, wt.f)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                proj4 = self.crs.to_proj4()
            self.info = {
                "file": self.path.name, "bytes": self.path.stat().st_size,
                "width": ds.width, "height": ds.height,
                "native_res_m": abs(ds.transform.a), "dtype": ds.dtypes[0],
                "nodata": None if ds.nodata is None else float(ds.nodata),
                "scale": float(scale), "offset": float(offset),
                "crs_proj4": proj4, "sphere_radius_m": self.radius,
                "used_res_m": abs(self.gt[0]),
            }
        if self.gt[1] != 0.0 or self.gt[3] != 0.0:
            raise ValueError(f"{self.path.name}: rotated rasters are not supported")
        self.res = abs(self.gt[0])

    def sample(self, x, y):
        """Bilinear height at map coordinates. NaN outside or on nodata."""
        x, y = np.asarray(x, dtype="float64"), np.asarray(y, dtype="float64")
        shape = x.shape
        a, _, c, _, e, f = self.gt                  # x = a*col + c, y = e*row + f
        col, row = (x.ravel() - c) / a, (y.ravel() - f) / e
        coords = np.array([row - 0.5, col - 0.5])   # pixel centres
        out = map_coordinates(self.z, coords, order=1, mode="constant", cval=np.nan)
        return out.reshape(shape)


def unit(lat_deg, lon_deg):
    la, lo = np.radians(lat_deg), np.radians(lon_deg)
    return np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def local_frame(lat_deg, lon_deg):
    up = unit(lat_deg, lon_deg)
    east = np.cross([0.0, 0.0, 1.0], up)
    east /= np.linalg.norm(east)
    return up, east, np.cross(up, east)


def ray_distances(start, stop, growth):
    out, s = [], start
    while s < stop:
        out.append(s)
        s += max(start, s * growth)
    return np.array(out)


def horizon(lat, lon, dem_paths, mast_m=2.0, az_step=0.5, max_range_km=220.0,
            growth=0.004, sigma_m=None, err_paths=None, dem_radius_km=None):
    """Horizon profile and occluders for one site.

    dem_paths: finest first.
    sigma_m: None, or one height error (metres) per DEM in dem_paths.
    err_paths: None, or one per-pixel height error raster (metres) per DEM in
      dem_paths. Takes precedence over sigma_m. All layers used need one.
    dem_radius_km: None, or per DEM the radius to load around the site (None
      = max range). Lets a fine grid cover the near field at full resolution.
    Returns a dict of numpy arrays (NaN where the occluder is null).
    """
    max_range = max_range_km * 1000.0
    dems, skipped = [], []
    for k, p in enumerate(dem_paths):
        rad = max_range
        if dem_radius_km is not None and dem_radius_km[k] is not None:
            rad = min(max_range, dem_radius_km[k] * 1000.0)
        try:
            d = Dem(p, lon, lat, rad)
            d.order = k
            dems.append(d)
        except ValueError as err:
            skipped.append(str(err))
    if not dems:
        raise ValueError("no DEM covers the site: " + "; ".join(skipped))
    R = dems[0].radius

    h0 = None
    for d in dems:
        v = float(d.sample(*d.fwd.transform(lon, lat)))
        if np.isfinite(v):
            h0, h0_file = v, d.path.name
            break
    if h0 is None:
        raise ValueError("the site falls on nodata in every DEM")
    r0 = R + h0 + mast_m

    up, east, north = local_frame(lat, lon)
    az = np.arange(0.0, 360.0, az_step)
    s = ray_distances(dems[0].res, max_range, growth)
    a = np.radians(az)[:, None, None]
    th = (s / R)[None, :, None]
    u = np.cos(th) * up + np.sin(th) * (np.cos(a) * north + np.sin(a) * east)
    p_lat = np.degrees(np.arcsin(np.clip(u[..., 2], -1, 1)))
    p_lon = np.degrees(np.arctan2(u[..., 1], u[..., 0])) % 360.0
    del u

    h = np.full(p_lat.shape, np.nan)
    src = np.full(p_lat.shape, -1, dtype=np.int8)
    for k, d in enumerate(dems):
        need = np.isnan(h)
        if not need.any():
            break
        v = d.sample(*d.fwd.transform(p_lon[need], p_lat[need]))
        h[need] = v
        got = need.copy()
        got[need] = np.isfinite(v)
        src[got] = k

    th2 = th[..., 0]
    rows = np.arange(len(az))
    s_grid = np.broadcast_to(s, h.shape)
    coverage = np.where(np.isfinite(h), s_grid, 0.0).max(axis=1)

    # Assumed datum-height terrain beyond the data: its highest point is the
    # sphere's tangent point, or the edge of coverage if that lies farther.
    d_tan = R * math.acos(R / r0) if r0 > R else 0.0
    c = np.maximum(np.maximum(coverage, d_tan), s[0]) / R
    floor = np.degrees(np.arctan2(R * np.cos(c) - r0, R * np.sin(c)))

    def skyline(heights, r_obs=r0):
        r1 = R + heights
        elev = np.degrees(np.arctan2(r1 * np.cos(th2) - r_obs, r1 * np.sin(th2)))
        elev = np.where(np.isfinite(elev), elev, -np.inf)
        i = elev.argmax(axis=1)
        return elev[rows, i], i

    terr, idx = skyline(h)
    mid = np.maximum(terr, floor)
    real = terr >= floor                       # a real DEM cell sets the horizon
    occ_dist = np.where(real, s[idx], np.nan)
    occ_lat = np.where(real, p_lat[rows, idx], np.nan)
    occ_lon = np.where(real, p_lon[rows, idx], np.nan)
    occ_src = np.where(real, src[rows, idx], -1)

    site_sigma, occ_sigma, err_info = None, np.full(len(az), np.nan), []
    if err_paths is not None:
        # Per-pixel published height error, read on the same ray samples.
        sig_grid = np.full(h.shape, np.nan)
        for k, d in enumerate(dems):
            ep = err_paths[d.order]
            if ep is None:
                raise ValueError(f"no error map for {d.path.name}")
            e = Dem(ep, lon, lat, max_range if dem_radius_km is None or dem_radius_km[d.order] is None
                    else min(max_range, dem_radius_km[d.order] * 1000.0))
            med = float(np.nanmedian(e.z))
            if not (0.0 <= med < 1000.0) or np.nanmin(e.z) < 0.0:
                raise ValueError(f"{e.path.name}: values do not look like a height error in metres")
            mine = src == k
            v = e.sample(*e.fwd.transform(p_lon[mine], p_lat[mine]))
            sig_grid[mine] = np.where(np.isfinite(v), v, med)   # gaps: layer median
            if h0_file == d.path.name:
                sv = float(e.sample(*e.fwd.transform(lon, lat)))
                site_sigma = sv if np.isfinite(sv) else med
            err_info.append({"file": e.path.name, "for": d.path.name, "median_m": round(med, 3),
                             "native_res_m": e.info["native_res_m"]})
        del mine
    elif sigma_m is not None:
        sig = np.asarray([sigma_m[d.order] for d in dems], dtype="float64")
        sig_grid = np.where(src >= 0, sig[np.clip(src, 0, None)], np.nan)
        site_sigma = 0.0
    else:
        sig_grid = None

    if sig_grid is None:
        lo, hi = mid.copy(), mid.copy()
    else:
        hi = np.maximum(skyline(h + sig_grid, r0 - site_sigma)[0], floor)
        lo = np.maximum(skyline(h - sig_grid, r0 + site_sigma)[0], floor)
        lo, hi = np.minimum(lo, mid), np.maximum(hi, mid)
        occ_sigma = np.where(real, sig_grid[rows, idx], np.nan)

    return {
        "az_deg": az, "elev_deg": mid, "elev_lo_deg": lo, "elev_hi_deg": hi,
        "occ_dist_m": occ_dist, "occ_lat": occ_lat, "occ_lon_e": occ_lon,
        "occ_dem_index": occ_src, "occ_sigma_m": occ_sigma, "site_sigma_m": site_sigma,
        "err_maps": err_info, "coverage_km": coverage / 1000.0,
        "site_height_m": h0, "site_height_from": h0_file, "radius_m": R,
        "dems": [d.info for d in dems], "skipped": skipped,
        "n_ray_samples": int(len(s)), "max_range_km": max_range_km,
    }
