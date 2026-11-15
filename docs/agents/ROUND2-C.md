# Agent C — round 2 (Integration, QA & Story; this session)

> AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.

Start: `git fetch origin && git checkout c/work && git merge origin/main`.

## Tonight
1. Add `shackleton_sr1` and `shackleton_sr2` to `data-src/sites.yaml` (Gläser 2014 SR1/SR2, `kind: candidate`,
   `terrain: lola`, source URL + quote), rebuild `sites.json`, regenerate mocks/golden if needed.
2. `LICENSE` (MIT) and a service worker in `app/public/sw.js` that caches the shell and `data/**` for offline reload
   (B registers it in `main.ts`; send B the one-line snippet).
3. Make the CI deploy step fail loudly (remove `continue-on-error`) once Pages is enabled.
4. Review `a/data` and `b/app` in fresh context → `REVIEW.md` (correctness vs `docs/engine-spec.md`, contract use,
   banned claims, AI headers).

## Sunday
- 09:00, 13:00, 17:00: open a PR merging `c/work`, `a/data`, `b/app` into `main`; tests and build must pass first.
- 13:00: `docs/page-copy.md` — the three lead sentences, Detailed Description, AI use, data sources, references.
- 17:00: `docs/video-script.md` — 30 s, English subtitles, IM-1 re-enactment, no NASA logos.
- 19:00–22:00: final README, every link checked logged out, screenshot list for the human.
