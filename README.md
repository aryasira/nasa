# Slip Impact Brief — Lunar Landing Site Navigator

> NASA Space Apps Challenge 2026 · Team **Space City Ad Lunam** (Houston) · Challenge: *Lunar Landing Site Navigator*

When a lunar landing slips, **Slip Impact Brief** shows which sunlight and direct-to-Earth hours a site gains or loses,
and explains each change: the lunar day/night cycle, Earth's libration, or the terrain that blocks the view, with its
direction and distance.

**Status:** under construction during the hackathon (14–15 Nov 2026). Features are listed below only once implemented.

## Implemented
- [x] Hourly Sun/Earth ephemeris in the Moon's mean-Earth frame (SPICE, DE440)
- [x] Terrain horizons with occluder attribution from LOLA for IM-1, IM-2, Chandrayaan-3, Connecting Ridge and two Shackleton rim sites
- [x] Sunlight / Earth-visibility metrics per site and date
- [x] Slip comparison with cause lines (orbital, terrain, site height)
- [x] Validation against JPL Horizons: 160 points at 7 LRO-located landing sites, all within 0.01°
- [x] Uncertainty bands from the published LOLA height-error maps, on all six terrain sites
- [x] Validation scorecard (`app/public/data/validation.json`) and long-run check against Gläser et al. 2014

## Data and tools (NASA and partners)
- NASA/NAIF SPICE kernels (DE440, lunar PA/ME frames) — https://naif.jpl.nasa.gov
- NASA JPL Horizons — https://ssd.jpl.nasa.gov/horizons/
- LRO LOLA topography (PDS / NASA GSFC PGDA)
- LRO LROC landing-site coordinates — https://lroc.im-ldi.com
- NASA Moon Trek — https://trek.nasa.gov/moon/

## AI use
This project was built with AI assistance (Anthropic Claude) for research, code drafting, testing and documentation.
The idea and every decision were made and reviewed by the human team. Files drafted with AI carry an
`AI-assisted` header comment, and every data file carries `meta.ai_generated: true`.

## Licence
Code: MIT (see `LICENSE`). Data keeps its providers' terms.

## Repository layout
See [`CONTEXT.md`](CONTEXT.md) for the full map, ownership and conventions.

```
contracts/   JSON schemas + TypeScript types (the interfaces between parts)
data-src/    hand-curated, sourced site catalogue (sites.yaml)
pipeline/    Python: SPICE ephemeris, Horizons fixtures, LOLA horizons
app/         Vite + TypeScript static web app (deployed to GitHub Pages)
tests/       contract + validation tests
tools/       build and mock-data scripts
```

## Run locally
```bash
pip install -r requirements.txt
python tools/build_sites.py && python tools/make_mocks.py
python -m pytest -q tests
cd app && npm install && npm run dev     # then open http://localhost:5173
```

No NASA logos or insignia are used in this project. NASA does not endorse this project.
