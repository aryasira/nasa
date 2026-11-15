# STATUS-B

_Updated: Sat 14 Nov 2026, 17:10 CT_

<!-- AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team. -->

## Done
- Merged `a/data` (7d4de7c, which already contains `c/work`) into `b/app` to build on the real data,
  `docs/engine-spec.md` and the golden vectors. No files outside B's paths were edited.
- Engine (`app/src/engine`), following `docs/engine-spec.md`:
  `ephem.ts` (loader, linear interpolation, Sun renormalised, no extrapolation), `geometry.ts` (site vector,
  ENU, az/el, **topocentric Earth**, angular radii, Sun-Earth separation, eclipse flags), `visibility.ts`
  (720-point horizon, disc fraction, limb/centre), `metrics.ts` (10-minute scan, `WindowMetrics`, bisection
  for set times, band only when `dem.sigma_m` is set), `slip.ts`, `causes.ts`.
- Tests (`npm test`, 7 passing):
  - all 48 golden instants and 10 golden windows (mock data, Python reference) within the file's tolerances;
  - all 140 real JPL Horizons fixtures within 0.01 deg; Earth parallax 0.2 to 0.3 deg;
  - cause lines add up to the change in visible hours to 1e-6 h at im1, im2 and connecting_ridge.
- UI (`app/src/main.ts`, `ui/charts.ts`, `style.css`): site picker with source and name status, UTC date,
  stay, slip, limb/centre, ranked options table with cause lines, timeline, 360-degree horizon panorama with
  Sun and Earth paths, Horizons check recomputed live, print CSS for a one-page brief, permalink (query
  string), `?data=mock` switch with a MOCK DATA banner, footer with AI-use and non-endorsement text.
- `npm run build` passes (JS 30 kB, 12 kB gzipped). Checked in headless Chrome: real data, mock data, a
  sphere site, centre mode and an out-of-range date; no console errors.

- **Published-benchmark check (17:10):** Connecting Ridge, real terrain, whole ephemeris 2024-2030, limb rule:
  sunlit **91.24%** of the time, longest dark stretch **4.7 days**, Earth in view 58.5%. Published
  (Gläser et al. 2014, 19-year run, 2 m): 92.27%, longest darkness typically 3 to 5 days. With the centre
  rule: 86.6%. Shown live in the app's trust panel for that site and guarded by a test (89 to 95%).
  **C:** usable in the validation section; say "different time span and newer DEM".

## How cause lines work (no spec existed, so this is B's design; C please review and add to the spec)
visible hours = hours above a flat terrain-free horizon − hours hidden by terrain + hours seen below the
flat horizon where the real horizon dips under 0 deg. The change between two windows is split the same way:
- **orbital**: change in terrain-free hours (lunar day/night for the Sun, libration for Earth);
- **terrain**: per occluder (feature id, or unnamed terrain merged across neighbouring 30-degree sectors),
  with mean azimuth and the pipeline's occluder distance at that azimuth;
- **dip** ("site height"): the site looks down past the flat horizon.
The split is exact. Pieces under 0.5 h are not listed.

## In progress
- Nothing open. Waiting for the 17:00 merge window.

## Next
- Sun 09:00: band display once Agent A sets `dem.sigma_m`. Then COULD items after the 13:00 gate.
- Lighthouse accessibility run (not done yet; no Lighthouse in this workspace).

## Blocked / needs other agent
- **C (contract, before the 17:00 freeze): `CauseLine` needs a `kind`.** Most real changes are orbital, not
  terrain. B extends the type locally (`CauseLineEx.kind: 'terrain' | 'orbital' | 'dip'`); for orbital lines
  `az_deg` is NaN because the contract requires a number. Please add `kind` and allow `az_deg: number | null`.
- **C (contract): ephemeris starts 2024-01-01.** The IM-1 baseline (19 Jan 2024) cannot search or draw
  before 1 Jan 2024, and Chandrayaan-3's landing (Aug 2023) is outside coverage. Starting at 2023-01-01
  costs 0.25 MB. The app clamps to coverage and shows a clear error outside it.
- **C / human (story): the brief's example cause line cannot happen.** "Blocked by Malapert massif at
  az 172°, 14 km": at IM-1 the Sun is never above the horizon between south-east and south-west. Real
  result for IM-1 (7-day stay from 19 Jan 2024 23:24 UTC, 10-day slip): 155.3 h → 82.0 h, main cause
  "Sun lost 69 h, lunar day/night cycle, not terrain", next date as good as baseline 18 Feb (+30 d).
  That is the "days became a month" story, and it is orbital. Terrain lines at IM-1 are local slope
  (az 69°, 0.3 km; az 264°, 2 km), all unnamed.
- **Human (preset):** the brief's "baseline 2024-01-19 vs actual 2024-02-22" preset shows a 13 h *gain*
  for a 7-day stay, so B added three presets: "IM-1: a 10-day slip" (default), "IM-1: January plan vs
  actual landing", "IM-2: a 7-day slip". The 19 Jan date is from a secondary source; please confirm.
- **A:** `im1` and `chandrayaan3` have 0% named occluders, so every terrain line there says "unnamed
  terrain". `im1`'s horizon peaks at 11° from ground 200 to 600 m away on an 80 m grid.
- **A / C:** "alternate sites" are the three nearest catalogue sites within 1000 km on the slipped date.
  Only four sites have terrain, so this is thin; more polar candidate sites would help.
- **C (offline):** "works offline after first load" holds only while the page stays open (all data is in
  memory). A reload offline needs a service worker in `app/public/`, which is outside B's paths.
- **Human:** GitHub Pages will not deploy while the repo is private on a free plan, and the deploy step has
  `continue-on-error: true`, so CI stays green either way. No LICENSE file yet.
