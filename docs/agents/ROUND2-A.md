# Agent A — round 2 (paste into your existing Agent A session)

> AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.

Round 1 is merged into `main`. Thank you — all 140 Horizons fixtures pass. Start with:
`git fetch origin && git checkout a/data && git merge origin/main`, then re-read `CONTEXT.md` (lead sentences changed:
IM-1's losses are orbital; never write a named-ridge cause for IM-1) and `docs/agents/PLAN.md`.

Remember: this cloud workspace cannot reach NASA servers. Write and test code here; the human runs
`python3 pipeline/run_all.py --fine 40` on their Mac **once**, so put everything below into that single run.

## Tasks (in order)
1. **Ephemeris from 2023-01-01** (Agent B and the human asked). New contract values, **pre-approved by C and the human**:
   `t0_utc: "2023-01-01T00:00:00Z"`, `n: 70128` (2023-01-01T00Z … 2030-12-31T23Z). In the same commit you may edit
   **only** `t0_utc`, `n` and `notes` in `contracts/ephem.header.json`, then run `python3 tools/make_mocks.py` and
   `python3 tests/reference/make_golden.py` so the mocks and golden vectors match. Keep `schema_version: 1`.
   Horizons fixtures: add 10 epochs for `chandrayaan3` around its landing (23 Aug–3 Sep 2023).
2. **Uncertainty bands on real data** — your code is ready; make sure the Mac run produces them for all four terrain
   sites and sets `dem.sigma_m`. Sanity check: band width at the peak azimuth should be well under 1°; flag anything
   wider in STATUS-A.
3. **Three more polar sites with terrain** (alternate-site search is thin with four). Add horizons for these ids;
   **C adds them to `data-src/sites.yaml`** tonight with sources (Gläser 2014):
   - `shackleton_sr1` 89.7742°S, 203.4952°E — Shackleton rim SR1
   - `shackleton_sr2` 89.6871°S, 197.0983°E — Shackleton rim SR2
   - `de_gerlache_rim` — **only if** you find a published high-illumination point with coordinates; otherwise skip
     and say so. Do not invent coordinates.
4. **Connecting Ridge elevation:** after the run, put `site_used.elev_dem_m` for `connecting_ridge` and `im2` in
   STATUS-A; C copies them into `sites.yaml`.
5. **Validation report** in `docs/science.md` (by Sun 13:00): residual table, parallax max, Connecting Ridge
   91.2% vs Gläser 92.27% (say "different time span and newer DEM"), band widths per site, list of data products
   with citations (PGDA 90 Barker et al. 2023, PGDA 78, NAIF kernels with sizes).

## Rules (unchanged)
Write only `pipeline/**`, real files in `app/public/data/` (not `mock/`, not `sites.json`), `docs/science.md`,
`docs/horizons-flags.md`, `STATUS-A.md` — plus the one pre-approved contract edit above and the regenerated
`app/public/data/mock/**` and `tests/golden/engine_vectors.json`. AI-ASSISTED headers, `meta.ai_generated: true`.
After **Sun 13:00**: bug fixes only. Commit with prefix `A:`, push to `a/data`, update STATUS-A.

## Done means
Mac run commit on `a/data` with 2023 ephemeris (n = 70128), bands with `sigma_m` set, horizons for 6 terrain sites,
all tests green (`python3 -m pytest -q tests pipeline/tests`), residuals still ≤ 0.01°.
