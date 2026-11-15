# STATUS-B

_Updated: Sun 15 Nov 2026, 12:58 CT_

<!-- AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team. -->

## Round 3: visual redesign below the simulator (Sun, PR #7 opened about 12:50 CT)
Times in the two sections below were estimates written during the work; the real clock was earlier than stated.
UI only. No engine maths, data or contract changes. Direction and references: `docs/design.md`.
- **01 Verdict strip** replaces the "What the slip does" text: Sun + Earth in view (before → after), change,
  main cause with an orbit/terrain icon, next equally good date. One sentence under it. The full "Why" and
  "Terrain" sentences, glosses and the IM-1 note are in a "Context" disclosure. An "illustrative date" tag
  stays visible.
- **02 Inputs** is one control bar: site, date, stay, slip stepper (− / +), visibility rule, Print, Copy link,
  three example chips.
- **03 Landing dates** (C's logic, re-marked-up): rhythm bracket and season range drawn on the chart; short key;
  the three paragraphs, the long legend and the click-mode control are in "Chart details".
- **04 Options** are ranked horizontal bars with a baseline tick, big hours, change and cause icons. Full cause
  sentences open with the row's "why" button (keyboard reachable) and are always in the DOM.
- **05 Timeline:** direct row labels, stays as brackets with their dates, table alternative in a disclosure.
- **06 Horizon:** blocking terrain labelled on the plot with leader lines (hours, skyline height, distance,
  bearing), north arrow, tick marks, "elevation ×N stretched" tag, Sun/Earth labels on the paths.
- **07 Compare:** small multiples. One strip per site (Sun, Earth, both across the stay) for the same landing
  date, most Sun + Earth hours first; choosing a strip makes it the landing site; smooth-sphere sites carry a
  "sphere" tag. C's sortable table and its site picker are unchanged, inside "Compare in a table".
- **08 Validation:** badge row (Horizons checks, Connecting Ridge sunlit vs published, terrain model or
  "no terrain model" in warning colour), a one-line site credit, and one "Method and limits" disclosure that
  collects every footnote. All numbers are read from the data files or computed live.
- Charts are now drawn at the real pixel width and redrawn on resize, so text stays readable at 390 px.

Checks (all on the built app, headless Chrome):
- `npm test` 42 passing, `npm run build` passes. JS bundle 202.2 kB gzip (limit 230); no new dependencies.
- Words outside the simulator, IM-1 state at 1280 px: 1,377 → 592 by `innerText`; 450 actually visible.
  **The 250 target is not met.**
- No horizontal scroll at 390 px. Stepper, "why" toggles, example chips, Explain mode and URL parameters work.
- Print: one page on Letter and A4 for IM-1, IM-2, Connecting Ridge, Apollo 11 and SLIM states.
- axe-core (WCAG 2 A/AA + best practice), three states: nothing new from B. Still open, all in C's files:
  `aria-pressed` on `div.sim-view` (critical), contrast of the sim's "Slipped · date" label, `.feat-explain`
  outside a landmark, and the tour `h3` heading order.
- Not checked: Lighthouse (not available), real phones, Safari/Firefox, contrast by hand beyond axe.

Touched outside B's usual files, as the brief allows: `app/src/features/index.ts` (markup only, logic and tests
unchanged), `docs/design.md`, `docs/design/*.jpg`. `app/src/sim/*` untouched.

## Live-review fixes (Sun 12:00 to 12:25 CT)
Merged `origin/c/work` at 081756a (the head of **open PR #6**) so the cause wording in `causes.ts` matches what
will land on main; merge `main` again once PR #6 is merged. `main.ts` edits are in place; hooks untouched.
- (1) A link to a site with no data (e.g. `site=shackleton_sr1`) now shows a message naming the site and the
  one shown instead. It clears when the user picks a site.
- (5) Alternate-site rows no longer repeat the baseline site's terrain line: for a different site, the
  baseline's terrain is part of the "different location" line; only the alternate's own terrain is listed.
- (6) `mode=center` (US spelling) is accepted and kept as centre.
- (7) One rounding rule: hours are shown to one decimal everywhere (summary, cause lines, chart markers).
- (8) One wording: "10-day slip" / "10-day advance" in the headline, the table and the page title.
- Gloss lines for "libration" and "net of site height" appear under the summary when those words are used.
- Alternate rows are shorter: "Alternate: <site>", "379 km away, same date.", two cause lines.
- The date field is a text field in 24-hour UTC (`YYYY-MM-DD HH:MM`); links accept a space or `T`.
- After PR #6 merged (12:06 CT), merged `origin/main` (d19e68e) as asked. C's new feature sections had pushed the
  print brief to two pages; print now leaves out the landing-date explorer, site comparison and alternate rows
  (with a line pointing to the on-screen version) and is back to one page on Letter and A4 for five scenarios.
- Checks: `npm test` 42 passing, build passes, each item checked in headless Chrome; axe-core on the IM-2
  state: no new violations in B's parts.

## Round 2 (Sun 11:15 to 11:45 CT)
Merged `origin/main` (d509614, includes the simulator) and `origin/c/work` (1eb4a2d, C's cause-line and slip
fixes in B's files) into `b/app`. **`main.ts` was not restructured**: only small in-place edits; the SIM HOOK
lines and `app/src/sim/**` are untouched.

### REVIEW items 1 to 5 (cause-line correctness)
Already fixed by C in `c/fix-causes`; B checked each on real data and kept C's code:
1. One net non-terrain line per body. IM-2, 10-day stay, +7 d: "Earth in view 240.0 h → 157.7 h (−82.3 h);
   main cause: Earth's libration, net of site height (−82.3 h)". No cancelling pair.
2. Negative slip: no recovery option, no "0-day wait" (checked with −4 d).
3. Alternate sites: the non-terrain line says "different location and date".
4. Note now reads "Per body, the cause lines sum to the change in that body's visible hours, apart from
   pieces under half an hour".
5. Unnamed terrain is keyed by azimuth runs across both windows; distances under 3 grid cells print "< 0.5 km".

### Round-2 tasks
1. **Uncertainty bands: done, waiting for real sigma.** With `dem.sigma_m` set, the table shows
   `82.0 (78–85)` for sunlit, Earth %, Sun + Earth and dark gap, the change shows `−73.3 h (−78 to −70)`, the
   headline carries the same band, and the panorama draws the lowered/raised horizon as a light band.
   Tested in Vitest on a synthetic ±0.1° horizon. No real horizon file has `sigma_m` yet, so nothing shows today.
2. **Accessibility: axe-core 4 (WCAG 2 A/AA + best practice) run in headless Chrome on three states.**
   Lighthouse was not available. B's parts: **0 violations**, 53 to 54 rules passing. Added: `aria-live` on the
   summary, a page title per state, `<title>` + `<desc>` on both charts, a "Timeline as a table" alternative.
   Remaining violations are in the simulator / hook (**C**):
   - critical `aria-allowed-attr`: `<div class="sim-view" aria-pressed="true">` (needs `role="button"` or a `<button>`);
   - serious `color-contrast`: the sim label `<span>Slipped · 03/13</span>` (seen on the IM-2 state);
   - moderate `region`: `<h2 class="brief-h" id="h-brief">` sits outside any landmark (move it inside `<main>`).
3. **Alternate sites: done.** Polar sites (|lat| ≥ 60°) only get terrain-modelled sites within 150 km; otherwise
   the page says "No terrain-modelled site within 150 km, so no alternate site is offered." Non-polar sites keep
   the nearest catalogue sites within 1000 km. Today no polar site has a terrain neighbour within 150 km
   (IM-1 to IM-2 is 175 km), so polar scenarios show no alternates until `shackleton_sr1/sr2` horizons land.
4. **Cause line as the hero: done.** Under the headline: "Why:" (one net sentence per body, C's) plus a new
   "Terrain:" sentence with the two largest terrain lines, or "no terrain change of half an hour or more".
5. **Print brief: done.** One page on Letter and A4 for IM-1, IM-2, Connecting Ridge, SLIM and Apollo 11
   scenarios (checked by PDF page count). Includes the permalink as text, sources and the AI-use line. Print
   hides the simulator, legends, notes and the cause rows of recovery/alternate options.
6. COULD items: not started (need the human's OK after the 13:00 gate).

Also: no hard-coded 2024 left in the trust panel (years come from the ephemeris header).
Tests: `npm test` 29 passing; `npm run build` passes.

### Blocked / needs other agent (round 2)
- **A:** `sites.json` lists sites with no horizon file yet (`shackleton_sr1`, and others); the app hides any
  site without a horizon. Ephemeris header still starts 2024-01-01. Bands need `dem.sigma_m`.
- **C:** the three simulator accessibility items above. One of C's tests assumed far alternates; B passes
  `alternateRangeKm: 1000` in that test so it still exercises alternates.
- **Human:** IM-1 now shows no alternate site at all (nearest terrain site is 175 km away). If you would rather
  keep IM-2 as an alternate for IM-1, say so and B will widen the range to 200 km.

---
## Round 1 notes (Sat) — kept for reference; several items below are now resolved


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

## Fixes made from the Agent A session at the human's request (Sun 15 Nov, 12:45 CT, branch `b/a-fixes`)
Branch = `b/app` (ab910bd) + `main` (e1c712e) + `a/data` (8670e9d, the checked Mac run) + the fixes below.
Vitest 43 passed, Python 34 passed, `npm run build` ok. Not looked at in a browser.
- Works with the new data: `site_used.stands_on` is a list now; `siteIsOn` accepts list or string.
- Regression numbers moved by one 10-minute sample on the 40 m terrain: IM-1 baseline 155.3 -> 155.5 h
  (slipped stays 82.0 h); IM-2 Earth -82.3 -> -82.5 h, Sun -90.3 -> -90.5 h. Tests updated.
  **C: lead sentences and page copy that quote 155.3 h need 155.5 h.**
- A link to an unknown or not-yet-built site now shows a notice instead of silently loading IM-1.
- `mode=center` is accepted as `centre`; an unknown mode shows a notice.
- Cause lines use one decimal ("lost 18.5 h"), matching the "-18.5 h" beside them.
- An earlier landing is labelled "10 d earlier", not "-10 d slip".

### Improvements added on `b/a-fixes` (Sun 15 Nov, 13:40 CT), checked in headless Chrome on the built app
- **Earth link margin** (0, 2, 5, 10 deg): Earth counts as in view only when it clears the skyline by
  the margin. One setting in `engine/visibility.ts`, used by the brief, countdowns and simulator.
  URL parameter `margin`. Default 0, so no existing number moves.
- **Download CSV / Download JSON** of the options table (`ui/export.ts`), with the scenario and
  `ai_generated: true` in the file.
- **Site-by-date map** (`features/heatmap.ts`): hours with Sun and Earth for a stay, every terrain
  site against 193 landing dates. One-hue ramp, hover values, best-date marker, table view.
  Computed on a button press, 30-minute samples.
- Vitest 46 passed, build ok, no console errors.
Not done: confidence tag and mast selector (need `occluder.cells` and mast files from a 1-minute
pipeline rerun), Sun fraction, DSN station view (needs a new data file), Web Worker.

### Agent C items done on `b/a-fixes` at the human's request (Sun 15 Nov, 14:05 CT)
- 3D view no longer traps the page scroll. Plain wheel scrolls the page; Ctrl or Cmd + wheel zooms;
  full screen zooms as before. Checked in headless Chrome. Caption says so.
- `CONTEXT.md` lead sentences and `README.md`: 140 -> 160 Horizons points; IM-1 155 -> 155.5 h;
  Connecting Ridge long-run sunlight 91.25% over 2023 to 2030 (88.2% to 93.1% across the band).
  The published 92.27% lies inside that band.
Left for C: globe shape and floating marker, lander view as the default camera, phone-width pass,
video, submission text.

### More B and C items on `b/a-fixes` (Sun 15 Nov, 15:00 CT), checked in headless Chrome
B:
- Terrain on the feature a site stands on now reads "higher ground on Mons Mouton" when it is not
  close by, "local terrain" only when close. Never "blocked by Mons Mouton".
- Alternate rows: baseline-site terrain lines say "(the baseline site)".
- Empty band ranges such as "(+147 to +147)" are hidden.
- Date label shows the value in 24-hour time.
- Headline adds "Longest stretch without Sun" for both stays.
- New section "Earth above the skyline, 30 days" (`features/earthplot.ts`), with the link margin line.
- Confidence tag: a terrain cause under 3 grid cells away gets ", low confidence". It reads
  `occluder.cells`, which the data does not have until the short pipeline rerun. Until then no tag shows.
C:
- Globe: faint night-side fill, so the disc reads as a sphere and dark-side markers do not float.
  The "lumpy" look was the lit part alone on a black background, not the geometry.
- Simulator opens on the lander view (`cam=lander` default).
- `data-src/sites.yaml` DEM heights: im2 5321.8, connecting_ridge 1958.6, shackleton_sr1 1734.0,
  shackleton_sr2 1727.8 m. `sites.json` rebuilt. 160 Horizons fixtures still pass.
Vitest 47 passed, Python 34 passed, build ok, no console errors.
Not done: mast selector (no mast files yet), Sun fraction (frozen contract), DSN view (new data),
IAU features near IM-1 and Chandrayaan-3 (no Gazetteer ID found for Malapert A; IM-1's skyline is
set by ground within 500 m, so a crater name 26 km away would not name anything).

### Merge state of `b/a-fixes` (Sun 15 Nov, 12:40 CT, real clock)
Correction: the clock times in the three sections above were guesses and are wrong. All of that
work was done between about 12:00 and 12:40 CT.
`b/a-fixes` now contains `main` (9afba58) and `b/app` (854ffe6), merged and conflict-free.
Where B or C had already fixed the same thing, their version was kept: C's scroll fix, round globe,
lander default and blocker names; B's link notice, mode alias, text date input, one-decimal hours
and "N-day advance" label. Kept from this session: new-data compatibility, Earth link margin,
CSV/JSON export, site-by-date map, Earth clearance plot, longest-night line, confidence-tag hook,
"(the baseline site)", empty-band hiding, DEM heights in sites.yaml, updated lead numbers.
Vitest 47 passed, Python 34 passed, build ok, headless Chrome check ok.
One thing seen: in headless Chrome the plain wheel over the 3D view did not scroll the page with
C's fix. It may behave differently in a real browser. Check it on the live site.

### `b/a-fixes` after B's round 3 redesign (Sun 15 Nov, 13:35 CT, real clock)
Merged `main` 1d6a154 (B's redesign, PR #7) and `a/data` 29a3382 (A's round 3). `main.ts` is B's
redesigned version. Re-attached to it, in B's layout: Earth link margin field, CSV and JSON buttons,
section "All terrain sites by landing date", section "Earth above the skyline, 30 days".
Dropped because the redesign replaced that part: the longest-night sentence and the 24-hour label.
Vitest 47 passed, Python 38 passed, build ok, headless Chrome ok, no console errors.
Seen at 1280 px in "Options ranked": the band text "(+7 to +8)" overlaps the cause chips. B's layout.
