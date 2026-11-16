# REVIEW.md — Agent C review of a/data + b/app (Sat 14 Nov, 23:40 CT)

> AI-assisted; see README.

Fresh-context review of `c/work` (= main + C's fixes). Tests: Python 17 passed, Vitest 8 passed.
Geometry, ephemeris, metrics, pipeline maths, compliance and security were checked and are **sound**.
The problems are in how cause lines are **split and worded** — the project's differentiator — so they come first.

## For Agent B — fix before Sun 09:00 (in this order)
1. **Net orbital + dip per body (HIGH).** `causes.ts:97-146`, `main.ts:169-173`. Gross orbital and "site height" pieces
   are reported separately and cancel (IM-2 +7 d: "Earth lost 123 h" + "gained 41 h" while the net is −82 h;
   Connecting Ridge: −193 h / +171 h). The headline then quotes a cause bigger than the loss.
   Fix: one line per body, `delta = visible(b) − visible(a) − Σterrain`, labelled "orbital (net of site height)";
   rank the headline by net per-body change.
2. **Negative slip makes a "+0 d recover" option (HIGH).** `slip.ts:358-375`. Only search for recovery when
   `slipDays > 0` (or start at `max(tSlip, tStart) + 1 day`). If `fits(tSlip)` is false, throw a `RangeError` so the
   error banner shows, instead of "Enter a slip…".
3. **Alternate sites worded as day/night or libration (HIGH).** `causes.ts:100-106`. When the site changes, say
   "different location: …" instead of "the lunar day/night cycle…".
4. **"Add up exactly" claim (HIGH).** `main.ts:210` → "Per body, cause lines sum to the change in that body's
   visible hours (pieces under 0.5 h omitted)."
5. **Unnamed-terrain sector keys differ between windows (MEDIUM).** `causes.ts:42-50` → build occupied 0.5° bins from
   *both* windows, form runs (gaps ≤ 3°), key by run, so the same ridge gets the same key ("gained 67 h az 82°" +
   "lost 4.7 h az 66°" is one ridge).
6. **Distance from the hidden samples, not the mean azimuth (MEDIUM).** `causes.ts:122-123` → median of
   `dist_m[azIndex(az[k])]` over hidden samples.
7. **Spurious precision (MEDIUM).** Distances under 3 × `dem.res_m` print as "< 0.5 km".
8. **`az_deg: NaN` → `null`** for orbital lines (contract is `number | null`), `causes.ts:104`.
9. **Wording (MEDIUM):** drop "19-year run" (`main.ts:107`, unsourced); IM-1 January preset → "illustrative baseline
   date (original window 12–16 Jan 2024)" (`main.ts:27-28`).
10. LOW: escape `value="${x.id}"` (`main.ts:127`); note that "Sunlit" includes eclipse hours; register `sw.js`:
    `if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js');`

## For Agent A
1. **Feature matching names the ground the site stands on (MEDIUM).** 671/720 azimuths at im2 → "Mons Mouton",
   453/720 at connecting_ridge → "Connecting Ridge". Skip features that contain the site (or mark "(site is on it)").
2. LOW: `check_vs_horizons.py:158` rejects the last ephemeris row (`i >= len(rec)-1`); engine accepts it.

## For C (done in this commit)
- README: removed the stale "names the ridge" claim and stale run instructions; ticked what is implemented.
- `contracts/types.ts` still has the old "Malapert massif at az 172°" example in a comment — **needs human OK** to edit
  (frozen contract). Harmless at runtime.
