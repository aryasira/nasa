# CONTEXT.md — read this first (every agent, every session)

> AI-ASSISTED: this file was drafted with Claude (Anthropic) and reviewed by the human team.

## 1. Mission
Team **Space City Ad Lunam** (Houston Local Event), NASA Space Apps 2026, challenge **Lunar Landing Site Navigator**.
Product: **Slip Impact Brief** — a static browser app that shows, for a lunar landing site and date, when the
Sun and Earth are visible above the *local terrain horizon*, and what changes if the landing slips.

**Differentiator (lead with this everywhere):** every gained or lost window gets a **cause line** that says *why*:
the lunar day/night cycle or Earth libration (orbital), local slope, or a named terrain feature with its azimuth and
distance. Slip sliders, heatmaps and Horizons validation are table stakes — other teams have them. Cause lines are ours.
(Updated Sat 23:15: real data shows IM-1's slip losses are orbital, not a ridge. Never use the old
"blocked by Malapert massif at az 172°" example; it cannot happen at IM-1.)

Lead sentences for the project page:
1. When a lunar landing slips, Slip Impact Brief shows which sunlight and direct-to-Earth hours a site gains or loses, and explains each change: the lunar day/night cycle, Earth's libration, or the named terrain that blocks the view, with its direction and distance.
2. We re-enact Intuitive Machines' IM-1 (Houston): a 10-day slip cuts a 7-day stay from 155.5 to 82 hours of sunlight because of the lunar day/night cycle, so the next equally good date is a month later — how a launch-manifest slip of days became a slip of a month.
3. Every Sun and Earth position is checked against NASA JPL Horizons at 140 points at seven LRO-located landing sites (all within 0.01°), and Connecting Ridge's long-run sunlight (91.2%) is compared with the published 92.3% (Gläser et al. 2014).

## 2. Hard rules
- **Deadline:** submission Sun 15 Nov 2026, 23:59 CT. Team target: submitted by **23:30**.
- **AI disclosure lives inside the project** (judges don't see the form's SI field):
  - every generated source file starts with an `AI-ASSISTED` header comment;
  - every JSON data file has `meta.ai_generated: true`;
  - README has an "AI use" section; page Detailed Description says it too.
- **No NASA logos, insignia or "meatball"** in any asset. Credit NASA data in text only.
- English everywhere. Demo video ≤30 s with English subtitles.
- **Never claim a feature that isn't implemented.** Never invent a number or a source.
- No secrets, keys or tokens in the repo.

## 3. Repo map and ownership (exclusive write access)
| Path | Owner |
|---|---|
| `pipeline/**`, `app/public/data/*` (real data, not `mock/`), `docs/science.md`, `docs/horizons-flags.md` | **A — Data & Science** |
| `app/src/**`, `app/index.html`, `app/vite.config.ts`, `app/package.json`, `app/tsconfig*.json` | **B — Engine & App** |
| `contracts/**`, `tests/**`, `tools/**`, `data-src/**`, `app/public/data/sites.json` (built by `tools/build_sites.py`), `app/public/data/mock/**`, `.github/**`, `README.md`, `CONTEXT.md`, `docs/**` (except A's two files) | **C — Integration, QA & Story** |
| merges to `main` | **Human only** |

Never edit another agent's paths. If something outside your paths is wrong, write it in your `STATUS-<A|B|C>.md`
under "Blocked / needs other agent" and carry on with something else.

## 4. Contracts
All shapes live in `contracts/`. TypeScript mirrors are in `contracts/types.ts` (B imports them).
- `ephem.header.json` + `ephem.bin` — hourly Sun/Earth vectors in MOON_ME
- `sites.schema.json` — the site catalogue (`app/public/data/sites.json`, built from `data-src/sites.yaml`)
- `horizon.schema.json` — per-site horizon + occluder arrays (`app/public/data/horizon/<site_id>.json`)
- `features.schema.json` — named terrain features for cause lines
- `fixtures.schema.json` — Horizons validation fixtures

**Frozen at Sat 17:00 CT (schema_version 1).** After that, any change needs a written human OK and a `schema_version` bump.

## 5. Frames and conventions
- Body-fixed frame: **MOON_ME** (from `moon_de440_250416.tf` + `moon_pa_de440_200625.bpc`). Longitude **east-positive, 0–360**.
- Azimuth: degrees **clockwise from north**, 0–360. Elevation: degrees above the local horizontal plane
  (normal to the reference sphere at the site, R = 1737.4 km + site elevation).
- Time: UTC, ISO-8601 with `Z`.
- SPICE aberration correction: **`LT+S`** (matches Horizons "apparent", airless).
- **Earth must be topocentric:** `earth_site = earth_km − site_km`. Using the Moon-centre direction is wrong by up to
  ~0.26°, which moves Earthrise/Earthset by hours. This is an acceptance test.
- Interpolate ephemeris linearly between hourly samples, then **renormalise** the Sun unit vector.
- Visibility uses disc fraction: Sun radius ≈ 0.267°, Earth radius from distance (≈0.95°).
- Eclipses and libration are **computed from geometry**, never hard-coded lists.

## 6. Verified facts (use these; cite the source in UI/docs)
| Item | Value | Source |
|---|---|---|
| IM-1 site | 80.13°S, 1.44°E, landed 22 Feb 2024 ~23:24 UTC near Malapert A | NASA LRO release |
| IM-1 slip | Jan 12–16 window lost to SpaceX manifest shifts after weather; Malapert A lighting "only available for a handful of days each month" → mid-Feb | Intuitive Machines, Dec 2023 |
| IM-2 | 84.7906°S, 29.1957°E, 6 Mar 2025, Mons Mouton | LROC image 1408 |
| SLIM | 13.3160°S, 25.2510°E, −912 m, 19 Jan 2024 15:20 UTC | LROC image 1358 |
| Chandrayaan-3 | LROC 69.3741°S, 32.32°E, 532 m (ISRO alt 69.3733°S, 32.3186°E) | LROC image 1314; ISRO |
| Chang'e 6 | LROC 41.6385°S, 206.0148°E, −5256 m (Nature alt 41.6251°S, 206.0224°E) | LROC 1374; Nat. Comms 16:4219 |
| Apollo 11 LM | 0.67416°N, 23.47314°E, −1926 m | LROC image 938 |
| Apollo 12 LM | 3.0128°S, 336.5781°E, −1422 m | LROC image 938 |
| Blue Ghost M1 | 18.5623°N, 61.8103°E, −3650 m; Mons Latreille ~4 km to the SE | LROC image 1406 |
| Chang'e 7 | 2026 launch postponed (CMSA, 23 Aug 2026); lighting requirement "can no longer be met in the 2026 windows" (NARIT); 2027 per partners, unofficial | CMSA; NARIT 24 Aug 2026 |
| MOON_ME (DE440, DE421-aligned) vs DE421 ME | max 3.07e-7 rad (~53 cm), 2000–2040 | `moon_de440_250416.tf` comments |
| Connecting Ridge illumination | 92.27% of the time at 2 m (Gläser 2014); 88.0% avg at C1, 2 m (Gläser 2018) | Icarus 243; NTRS 20170007365 |

### Do NOT claim
- That lighting *caused* the IM-1 slip (it **amplified** a manifest slip).
- Any named-ridge cause line at IM-1 (its terrain lines are unnamed local slope).
- Any Blue Ghost sunset time as a numeric validation (unresolved ~2 h discrepancy). Qualitative only.
- Griffin-1 has launched or landed (it hasn't, as of 14 Nov 2026).
- Mazarico 2011 / Barker 2021 / Bryant 2009 figures (unverified).
- Artemis IV site or region coordinates.
- That our tool is the first to compute horizons. Claim: "the first tool we know of that explains each lost window in words."
- Feature names as IAU-official unless `name_status: iau` with a Gazetteer ID.

## 7. Schedule, merges, status
Merge windows (human merges `a/*`, `b/*`, `c/*` → `main`): **Sat 17:00, 21:00 · Sun 09:00, 13:00, 17:00, 19:00**.
Nothing merges 23:00–06:00; keep committing to your branch.

Gates: **Sat 17:00** contracts frozen + mocks · **Sat 21:00** first slice deployed (else sphere-only) ·
**Sun 13:00** cause lines done (else ship without uncertainty bands) · **Sun 19:00** feature freeze ·
**Sun 22:00** demo + page ready · **Sun 23:30** submitted.

Fallback ladder (drop one rung at a time): sky dome → assumption toggles → uncertainty bands → nearby-site
alternatives (keep same-site slip) → terrain horizons for most sites (keep 1 polar terrain site) → static IM-1 brief.

Status: update `STATUS-<letter>.md` at least every 2 hours and before each merge window:
`Done / In progress / Next / Blocked / needs other agent`.

Commits: small, on your own branch, message prefixed `A:`, `B:` or `C:`.
