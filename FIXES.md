# Fix List & Feature Backlog

## 🐛 Open Bugs

- [ ] **Feed direction chip arrows** — Arrow direction is wrong on the feed chip; needs correcting in `chips/feed-horizontal.svg` and `chips/feed-vertical.svg`
- [ ] **Paper chip fiber texture flickers** — `buildPaperChip` uses `Math.random()` on redraw. Needs the seeded LCG approach used in the paper-tooth chips.
- [ ] **Loupe staleness indicator** — No visual cue when the loupe cache is stale (image changed but loupe hasn't re-rendered).

---

## 🌟 Features

- [ ] **Spot color mode** — Two-color printing on white stock. User picks two solid ink colors; no halftone screening, just hard-separated coverage areas. Would need new worker pipeline path and mode chip state.
- [ ] **Escape key closes panel** — Three lines of code, just hasn't happened yet.
- [ ] **Export filename includes preset name** — Bake active preset name into the download filename.
- [ ] **Module reordering** — Drag to reorder modules within a group.
- [ ] **App file split** — `app.js` is 2126 lines. Natural split: `chips-press.js`, `chips-halftone.js`, `chips-print.js` leaving core at ~1000 lines.

---

## ✅ Done

### Architecture
- [x] Multi-file split (index.html / style.css / worker.js / data.js / app.js)
- [x] Web worker for all pixel processing
- [x] SVG chip asset library (`chips/` directory, preloaded at init, cloned per-use)
- [x] GitHub Pages deployment

### Pipeline UI
- [x] Pipeline strip with group labels, L-R chip layout, add-module dropdown
- [x] Add-module dropdown escapes overflow clipping (body-appended, fixed position)
- [x] Preset save/load/delete with localStorage persistence
- [x] Scrollbars beefed up (8px, rounded, hover highlight)
- [x] Double-click any slider to reset to default

### Press Config chips
- [x] Feed direction chip (horizontal/vertical toggle, paper roll L-R)
- [x] Ink laydown sequence chip (K–C–M–Y variants, animated rollers)
- [x] Pressure roller chip (vertical slider, nip gap animation)
- [x] Slur elongation chip (smeared dots, three severity states)
- [x] All press chips mirrored: paper roll on left, motion L-R

### Halftone chips
- [x] Mode chip (B&W / DUO / CMYK cards with live dot previews)
- [x] Screen chip (dot field preview, cellSize slider)
- [x] Dot shape chip (circle / diamond / line cards)
- [x] Paper color chip (color swatch, cascades to all previews)
- [x] Angle chips — MASTER overlay + per-plate (K/C/M/Y), live moiré
- [x] Duotone color chips (COLOR 1 / COLOR 2 labels, angle cascade)
- [x] Line shape rotates with screen angle in previews
- [x] cellSize slider cascades redraws to all chip previews

### Print chips
- [x] Dot Gain chips (gain / shadow fill, dot row previews)
- [x] Registration chips (XY crosshair pad, per-channel color)
- [x] Ink Skip chips (dot field with void bands, seeded noise)
- [x] Ink Bleed chips (anisotropic halo grid)
- [x] Hickeys chips (donut voids over dot field, seeded scatter)
- [x] Paper Tooth chips (texture grain + directional fiber streaks, seeded)

### Camera / Pre-screen chips
- [x] Film Stock chips (halation bloom / fade gradient)
- [x] Velox chips (live sigmoid tone curve)
- [x] Film Grain chip (bright/dark split panel, shadow weighting preview)
