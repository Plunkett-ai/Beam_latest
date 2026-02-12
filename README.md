# BEAM Value Proposition – ICB Localiser (fixed build)

## What this package includes
- **All 16 slides** from `BioVie_BEAM_Value_Proposition_Deck_v4.5.pptx` as background images (`assets/slide1.png` … `assets/slide16.png`).
- Dynamic population of the **blank containers** on:
  - **Slide 2**: ICB highlight map + local metrics boxes
  - **Slide 3**: challenge + illustrative impact boxes, with editable **% shift to BEAM**
  - **Slide 5**: localised referrals/accessed chart + 2024/25 snapshot boxes
  - **Slide 6**: local scale-of-activity + sessions-per-course trend
  - **Slide 7**: selected ICB median wait callout
  - **Slide 15**: localisation-ready inputs/outputs lists

## How to run
1. Unzip the folder.
2. Open `index.html` in a browser.
   - This build is **offline-friendly** (no `fetch()` and no external CDNs), so it should work by double‑clicking the HTML file.

## Controls
- **ICB dropdown** (top): changes the locality used across slides 2/3/5.
- **Slide dropdown + arrows** (top): navigate all slides.
- **Slide 2 map**: click an ICB region to select it.
- **Slide 3 adoption input**: type a % (e.g. `10`) to update savings / capacity / wait impact.

## Data sources
- ICB metrics come from `BioVie_BEAM_ICB_OnePager_Model_FIXED.xlsx` (provided by you).
- Map boundaries are simplified from the supplied ICB boundary file to keep load times fast.

## GitHub Pages deploy (important)
This ZIP is **flat** (the `index.html` is at the root). For GitHub Pages, copy/commit the **contents** of this ZIP to the repo root (or to your `/docs` folder if your Pages source is `/docs`).

If you previously uploaded a ZIP that contained a `beam-webapp/` folder, GitHub Pages will often keep serving your old root `index.html`. In that case the new app ends up at `/beam-webapp/` instead of `/`.
