> AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.

# Engine spec (schema_version 1)

The exact arithmetic `app/src/engine` must implement. Reference implementation:
`tests/reference/engine_ref.py`. Golden vectors: `tests/golden/engine_vectors.json` (from MOCK data,
regenerate with `python3 tests/reference/make_golden.py`). Do all maths in float64 (JS `number`).

## 1. Constants

| Name | Value |
|---|---|
| `R_MOON_KM` | 1737.4 |
| `R_EARTH_KM` | 6378.137 |
| `SUN_RADIUS_1AU_DEG` | 0.2666 |
| horizon `az_step_deg` | 0.5 (720 samples) |
| metrics step | 600 s |
| bisection tolerance | 1 s |

## 2. Ephemeris: `ephem.bin` + `ephem.header.json`

- `ephem.bin` = `n` records × 7 little-endian float32 (`record_bytes` 28), no header bytes.
  Record `i` is time `t_i = t0_utc + i·step_s` (step 3600 s). Columns (`EPHEM` in `contracts/types.ts`):
  `0..2 sun_ux,uy,uz` (unit, Moon centre → Sun, MOON_ME), `3 sun_au`, `4..6 earth_x,y,z_km` (Moon centre → Earth).
- `sample(t)`, `t` in seconds:
  - `f = (t − t0) / step_s`. If `t < t0` or `t > t0 + (n−1)·step_s`: error (no extrapolation).
  - `i = min(floor(f), n − 2)`, `w = f − i` (so the last row gives `i = n−2, w = 1`).
  - every column `c`: `x_c = (1 − w)·row_i[c] + w·row_{i+1}[c]` (widen to float64 first).
  - `sun_u = (x0, x1, x2) / |(x0, x1, x2)|` (renormalise). `sun_au = x3`. `earth_km = (x4, x5, x6)` (not normalised).

## 3. Geometry

Site (lat φ, lon_e λ in degrees; `elev_m` may be null → 0):

- `R = 1737.4 + elev_m/1000` km; `site_km = R·(cosφ cosλ, cosφ sinλ, sinφ)`. Mast height is **not** added
  (it is already in the horizon profile; 2 m changes nothing at 1e-3°).
- ENU basis (sphere normal):
  `E = (−sinλ, cosλ, 0)`, `N = (−sinφ cosλ, −sinφ sinλ, cosφ)`, `U = (cosφ cosλ, cosφ sinλ, sinφ)`.
  Undefined at exactly φ = ±90°; no catalogue site is there.
- Direction `d` (any length) → `e = d·E`, `n = d·N`, `u = d·U`,
  `az = atan2(e, n)` in degrees, mod 360, in [0, 360) (if rounding gives 360, use 0);
  `el = atan2(u, hypot(e, n))` in degrees.
- Sun: `d_sun = sun_u` as is (Sun at infinity, no site subtraction).
- Earth (mandatory topocentric): `d_earth = earth_km − site_km`; `dist = |d_earth|`.
  `earth_el_geocentric` = el of `earth_km` itself — only for the parallax test; never for visibility.
  On a sphere the parallax is purely vertical, so topocentric and geocentric **azimuths are equal**;
  the elevations differ by up to ≈0.27°.
- Angular radii: `r_sun = 0.2666 / sun_au` deg; `r_earth = asin(6378.137 / dist)` deg.
- Separation of Sun and Earth centres seen from the site:
  `sep = atan2(|sun_u × d_earth|, sun_u · d_earth)` in degrees (`acos` of the unit dot product is acceptable).

## 4. Horizon and visibility

- Horizon file `horizon/<site_id>.json`, array `h = elev_deg` (or `elev_lo_deg` / `elev_hi_deg` for the band).
  `h[i]` is at azimuth `i·0.5°`.
- `h(az)`: `x = az / 0.5`, `i0 = floor(x) mod 720`, `i1 = (i0 + 1) mod 720`, `w = x − floor(x)`,
  `h(az) = (1 − w)·h[i0] + w·h[i1]` (wraps 359.5° → 0°).
- Disc fraction (linear in elevation, evaluated at the body-centre azimuth only):
  `frac = clamp((el + r − h(az)) / (2r), 0, 1)`.
- Visible:
  - **limb** (default): `frac > 0` (upper limb above terrain).
  - **centre** (alternate toggle): `frac ≥ 0.5`.
- Earth eclipses Sun (pure geometry, no horizon): **partial** `sep < r_earth + r_sun`;
  **total** `sep < r_earth − r_sun`. Total implies partial.

## 5. Window metrics (`WindowMetrics`)

Input: site, `start`, `end` (= start + days·86400 s), mode (limb | centre), horizon array (elev / lo / hi).

- Grid `t_k = start + 600·k`, `k = 0..N`, `N = round((end − start)/600)`. `t_N = end`.
- `S_k` = Sun visible, `E_k` = Earth visible, `X_k = S_k AND eclipse_partial_k`.
- Durations use **left samples only** (`k = 0..N−1`), each worth 600 s = 1/6 h:
  - `sunlit_h = Σ S_k / 6` (eclipses are **not** subtracted; terrain only)
  - `earth_visible_pct = 100 · Σ E_k / N`
  - `both_visible_h = Σ (S_k AND E_k) / 6`
  - `eclipse_h = Σ X_k / 6` (Earth covering the Sun **while the Sun is above the terrain**)
  - `longest_dark_gap_h` = longest run of consecutive `k` (in `0..N−1`) with `NOT S_k`, × 1/6 h.
    Runs are clipped at the window edges (no look-before/after).
- `next_sunset_utc` (likewise `next_earthset_utc` with `E`): smallest `k` in `0..N−1` with
  `S_k AND NOT S_{k+1}` (uses the end sample `t_N`). Bisection: `lo = t_k, hi = t_{k+1}`;
  while `hi − lo > 1 s`: `mid = (lo+hi)/2`; if visible(mid) `lo = mid` else `hi = mid`.
  Report `hi` rounded to the nearest whole second, formatted `YYYY-MM-DDTHH:MM:SSZ`. `null` if no such `k`.
  A body that starts the window invisible therefore reports the first set after its next rise.
- `start_utc`/`end_utc` in the same format.
- `band`: the same metrics with `elev_lo_deg` (→ `band.lo`, lower terrain, so more visibility) and
  `elev_hi_deg` (→ `band.hi`).

Known limits (by design): visibility shorter than 10 min between grid points is not counted;
the disc fraction is linear in elevation, not area.

## 6. Cross-check against the golden file

`tests/golden/engine_vectors.json` (`meta.mock: true`, synthetic values) holds:
- `instants[]`: per site/UTC, `sun{az,el,radius,fraction}`, `earth{az,el,radius,fraction,dist_km}` (topocentric),
  `earth_el_geocentric`, `earth_az_geocentric`, `sun_earth_sep`, `eclipse_partial`, `eclipse_total`.
  Includes first/last ephemeris rows, non-hour instants and eclipse instants (total, partial-only, just outside).
- `windows[]`: `{mode, days, metrics: WindowMetrics}`; limb entries include `band`.
- `tolerances`: az/el/radius 1e-3°, fractions 1e-3, hours 0.2 h, `earth_visible_pct` 1.5, event times 60 s.
  Compare azimuths modulo 360.

Load the data from `app/public/data/mock/` in the Vitest test. If `tools/make_mocks.py` or this spec changes,
regenerate the golden file; the pytest `test_golden_regenerates` fails until you do.
