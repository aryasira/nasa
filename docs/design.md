# Design direction: "chart sheet" (round 3, everything below the simulator)

> AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.

**One direction:** the brief reads like a printed flight-dynamics chart sheet, not a stack of cards.

- **Grid:** a narrow left rail (148 px) holds the section number and name; the wide column holds the content.
  Sections are separated by one hairline rule. No boxes, no shadows, no rounded cards.
- **Type:** two faces only, both system stacks (no font CDN). Sans for names; monospace with tabular figures for
  every number. Micro-labels are 10.5 px uppercase, letter-spaced. The four verdict numbers are the largest
  things on the page.
- **Colour:** Sun amber, Earth blue, both-in-view green (Okabe-Ito, unchanged), one loss colour, one warning
  yellow, neutrals. Meaning never rests on colour alone: bars are hatched and every mark has a word or a sign.
- **Rules of thumb:**
  1. Show the number, then at most one sentence. Explanations go behind a disclosure; nothing true is deleted.
  2. Label the chart, not the page: line names, stays, blocking terrain, north arrow and vertical stretch are
     written on the plots.
  3. One rounding rule: hours to one decimal everywhere.

## References looked at
Only search-result summaries were read for these (titles and descriptions), not the full pages:
- Bartosz Ciechanowski, "Moon" — https://ciechanow.ski/moon/ (the chart is the explanation; sliders next to figures).
- Financial Times Visual Journalism Team, "Visual Vocabulary" — https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md
  (choose the chart from the relationship: ranking → ordered bars; change over time → line with annotations).
- Bret Victor, "Magic Ink: Information Software and the Graphical Interface" — https://worrydream.com/MagicInk/
  (information software is graphic design first; show the data, cut the interaction).

The Swiss/International grid and instrument-panel conventions (left-aligned, asymmetric, few weights, monospace
numerals) are applied from general knowledge, not from a specific page. No site's layout, logo or artwork is copied.

## Screenshots
`docs/design/before-1280.jpg`, `before-390.jpg`, `after-1280.jpg`, `after-390.jpg` (IM-1, 7-day stay, 10-day slip).

## Word counts (IM-1 state, 1280 px, everything outside the simulator)
| | Before | After |
|---|---|---|
| `innerText` word count (includes dropdown options and screen-reader-only text) | 1,377 | 608 |
| Visible words (dropdown options and screen-reader-only text removed) | not measured | 451 |

The target was about 250. What remains is labels, chart text, the compare table, and the header and footer
(the AI-use and non-endorsement lines stay visible on purpose).
