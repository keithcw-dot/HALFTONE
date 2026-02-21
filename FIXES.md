# Fix List & Feature Backlog

## 🐛 Bugs

### UI / Chips
- [ ] **Duotone angle chip labels** — In duotone mode, angle chips still show "K" and "C". Should read "COLOR 1" and "COLOR 2" to match duotone color chip labels.
- [ ] **Feed direction chip arrows** — Arrow direction is wrong; needs to be corrected.
- [ ] **Press config chip layout** — Chips should read left to right; images need to be mirrored.

### Rendering
- [ ] **Paper chip fiber texture** — Uses `Math.random()` on every redraw, causing flickering. Needs seeded/stable noise.
- [ ] **Loupe staleness indicator** — No visual cue when loupe cache is stale vs fresh.

---

## ✨ New Chips (replace existing slider controls)

- [ ] **Film Grain chips** — Visual chip controls for the FILM GRAIN module (amount, shadow weighting)
- [ ] **Velox chips** — Visual chip controls for the VELOX module (threshold, contrast)
- [ ] **Hickeys chips** — Visual chip controls for the HICKEYS module (count, size)
- [ ] **Ink Bleed chips** — Visual chip controls for the INK BLEED module (radius, absorbency, directionality)
- [ ] **Dot Gain chips** — Visual chip controls for the DOT GAIN module (gain amount, shadow fill)
- [ ] **Registration chips** — Wrap existing XY pad controls inside the press-chip card style

---

## 🌟 Features

- [ ] **Spot color mode** — Two-color printing on white stock (e.g. sign printing). Essentially duotone but with full coverage solids rather than halftone plates; user picks two Pantone-style colors.
- [ ] **Export filename includes preset name** — If a preset was applied, bake the name into the download filename.
- [ ] **Escape key closes panel** — QoL keyboard shortcut.
- [ ] **Module reordering** — Drag to reorder modules within a group.

---

## ✅ Done
- [x] Multi-file architecture (index.html / style.css / worker.js / data.js / app.js)
- [x] Pipeline strip layout (chips left-to-right, group label + add btn to right)
- [x] Add-module dropdown escapes overflow clipping (body-appended, fixed position)
- [x] Preset save/delete with localStorage persistence
- [x] Angle chips with live dot-field previews (MASTER overlay + per-plate)
- [x] Mode / Screen / Dot Shape / Paper / Duotone color chips
- [x] Line shape rotates with screen angle in previews
- [x] cellSize slider cascades redraws to all chip previews
- [x] GitHub Pages deployment
- [x] Duotone angle chip labels show COLOR 1 / COLOR 2
- [x] Ink skip chips (dot field with void bands; intensity + scale)
- [x] Paper tooth chips (seeded noise grain + directional fiber streaks)
- [x] Scrollbars beefed up (8px, rounded, hover highlight)
- [x] Double-click any slider to reset to default
