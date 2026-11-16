# Agent B — round 2 (paste into your existing Agent B session)

> AI-assisted; see README.

Round 1 is merged into `main` — great work. Start with:
`git fetch origin && git checkout b/app && git merge origin/main`, then re-read `CONTEXT.md` and `docs/agents/PLAN.md`.

## What changed under you
- `contracts/types.ts`: `CauseLine` now has `kind: 'terrain' | 'orbital' | 'dip'` and `az_deg: number | null`
  (your request). You can drop `CauseLineEx` and use `CauseLine` directly.
- **C made one fix in your file to unblock the deploy:** `app/src/main.ts` line ~201, terrain markers now filter
  `c.az_deg != null` and cast to `number`. Keep it or replace it with something cleaner.
- Agent A will extend the ephemeris to start **2023-01-01** (n = 70128). Don't hard-code 2024 anywhere; read `t0`/`n`
  from the header. The IM-1 January preset and Chandrayaan-3's landing should then work without clamping.
- Lead sentences: the IM-1 story is **orbital** ("a 10-day slip cuts 155 h of sunlight to 82 h; next equally good
  date is a month later"). Make sure the IM-1 preset's headline says exactly that, using computed numbers.

## Tasks (in order)
1. **Uncertainty bands in the UI.** When `dem.sigma_m` is set, show every hour metric and every delta as
   `82 h (78–85)`, and a light band around the horizon line in the panorama. Test it now with a synthetic horizon
   (lo = elev − 0.1°, hi = elev + 0.1°) in Vitest; real bands arrive Sun ~09:00.
2. **Accessibility to Lighthouse ≥ 90:** labels on every control, keyboard focus order, `aria-live` on the results
   region, contrast on the dark theme, `<title>` per state, SVGs with `role="img"` + `<title>`/`<desc>`, a text
   table alternative to the timeline. Test with axe-core in Vitest + jsdom if Lighthouse isn't available.
3. **Alternate sites:** A is adding `shackleton_sr1` and `shackleton_sr2` (terrain). Make the "nearby site" search
   prefer sites with `terrain: lola` within 150 km for polar sites, and say "no terrain-modelled site within 150 km"
   instead of offering a sphere site 900 km away.
4. **Make the cause line the hero.** Above the table, one sentence per body for the selected slip, e.g.
   "Sun: −73 h — lunar day/night cycle (orbital). Terrain: −2 h, unnamed slope at az 264°, 2 km." This is the
   project's differentiator; it should be the first thing a judge reads.
5. **Brief view polish:** the print view fits one A4/Letter page, includes the permalink as text, data sources,
   and the AI-use line.
6. **COULD, only after Sun 13:00 and the human's OK:** sky-dome horizon clock, then assumption toggles
   (sphere ↔ terrain, limb ↔ centre, mast height).

## Rules (unchanged)
Write only `app/src/**`, `app/index.html`, `app/vite.config.ts`, `app/package.json` (+ lock), `app/tsconfig*.json`,
`STATUS-B.md`. Run `npm run build && npm test` before every push (CI blocks the deploy if either fails).
AI-ASSISTED header on every file. Never show a feature that doesn't work. Commit prefix `B:`, push to `b/app`.
**Sun 19:00 freeze.**

## Done means
Bands shown with real data, Lighthouse/axe accessibility ≥ 90 (state the tool you used in STATUS-B), IM-1 preset
headline matches CONTEXT.md with computed numbers, print brief fits one page, build and tests green.
