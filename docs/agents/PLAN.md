# Plan to submission — Sat 14 Nov 23:30 → Sun 15 Nov 23:30 CT

> AI-assisted; see README.

## How to look at the app
- **Live (once deployed):** https://aryasira.github.io/nasa/ — needs the repo public, Settings → Pages → Source
  "GitHub Actions", and a green CI run on `main`.
- **On your Mac:** `cd nasa && git checkout main && git pull`, then `cd app && npm install && npm run dev` and open
  http://localhost:5173. (Needs Node 20+; get it from nodejs.org if `node -v` fails.)
- **Mock data:** add `?data=mock` to the URL. A yellow MOCK DATA banner shows; never screenshot that for the page.

## Who does what (round 2)
| Agent | Brief | Branch | Main jobs |
|---|---|---|---|
| A — Data & Science | `ROUND2-A.md` | `a/data` | ephemeris from 2023, uncertainty bands, 3 more polar sites with terrain, validation report |
| B — Engine & App | `ROUND2-B.md` | `b/app` | bands in the UI, accessibility, alternate-site search, then COULD items |
| C — Integration, QA & Story | `ROUND2-C.md` | `c/work` | reviews, merges via PRs, offline support, LICENSE, page copy, video script |
| Human | this file | — | Mac pipeline runs, merging PRs, the video, the submission form |

Every agent: **first** `git fetch origin && git merge origin/main` on your branch (main now has everyone's work), read
`CONTEXT.md` again (lead sentences changed), then your round-2 brief.

## Schedule (CT)
| When | A | B | C | Human |
|---|---|---|---|---|
| Sat 23:30 – 00:30 | 2023 ephemeris code, new sites | bands UI on synthetic band | merge main, offline, LICENSE | Make repo public, Pages on, merge PR #2. **One Mac run** (below). Then sleep. |
| overnight | idle unless data arrived | accessibility, alternate-site search | review A/B branches → `REVIEW.md` | sleep |
| Sun 09:00 | commit Mac outputs, validation report | wire real bands | PR: merge a/b/c → main | merge PR, check live site |
| Sun 13:00 **gate** | bug fixes only | COULD items (sky dome, toggles) | page copy draft | read page copy, decide COULDs |
| Sun 17:00 | — | bug fixes | video script, screenshots list | merge PR |
| Sun 19:00 **freeze** | — | — | final README, link check | record ≤30 s video with English subtitles |
| Sun 22:00 | — | — | final checks | fill the form, test links logged out |
| **Sun 23:30** | | | | **Submit** |

## The one Mac run (do it after A pushes its round-2 code, tonight or 08:00 Sunday)
```
cd nasa && git checkout a/data && git pull
python3 pipeline/run_all.py --fine 40
git add -A && git commit -m "A: Mac run — 2023 ephemeris, bands, new sites" && git push
```
If anything prints FAILED, paste the last 20 lines into Agent A's session.

## Fallback ladder (drop one rung at a time if late)
sky dome → assumption toggles → uncertainty bands → alternate sites (keep same-site slip) → terrain for all but IM-1
→ static IM-1 brief.

## Merge rule
Agents push only to their own branch. C opens a pull request into `main`; the human clicks Merge. Nothing merges
23:00–06:00 except tonight's PR #2.
