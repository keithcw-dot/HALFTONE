const MODULE_DEFS = {
  filmstock: {
    id: 'filmstock', group: 'CAMERA', label: 'FILM STOCK', removable: true,
    desc: 'Analog emulsion response — per-channel H&D curves, halation from light bouncing off the film base, and dye fade from aging.',
    params: [
      { id: 'stock',    label: 'Stock',    type: 'select', options: ['trix','hp5','kodachrome','portra','ektachrome'], labels: ['TRI-X 400','HP5 PLUS','KODACHROME 64','PORTRA 400','EKTACHROME 100'], default: 'kodachrome' },
      { id: 'exposure', label: 'Exposure', type: 'slider', min: -2, max: 2, step: 0.1, default: 0, unit: 'EV' },
      { id: 'halation', label: 'Halation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
      { id: 'fade',     label: 'Fade',     type: 'slider', min: 0, max: 1, step: 0.05, default: 0 },
    ]
  },
  velox: {
    id: 'velox', group: 'PRE-SCREEN', label: 'VELOX', removable: true,
    desc: 'High-contrast photographic paper used to make screened prints for paste-up. Sigmoid crush pushes tones toward black or white.',
    params: [
      { id: 'threshold', label: 'Threshold', type: 'slider', min: 0.1, max: 0.9, step: 0.01, default: 0.5 },
      { id: 'contrast',  label: 'Contrast',  type: 'slider', min: 1.0, max: 3.0, step: 0.1,  default: 1.5 },
    ]
  },
  grain: {
    id: 'grain', group: 'PRE-SCREEN', label: 'FILM GRAIN', removable: true,
    desc: 'Silver halide clumping from the original film negative. Shadow weighting concentrates grain in dark areas.',
    params: [
      { id: 'amount',   label: 'Amount',       type: 'slider', min: 0, max: 0.5, step: 0.01, default: 0.12 },
      { id: 'weighted', label: 'Shadow Weight', type: 'toggle', options: ['off','on'], default: 'on' },
    ]
  },
  halftone: {
    id: 'halftone', group: 'SCREEN', label: 'HALFTONE', removable: false,
    desc: 'The core screening process. Continuous tones are broken into dots at a fixed grid angle.',
    params: [
      { id: 'mode',        label: 'Mode',            type: 'select', options: ['bw','duotone','cmyk'], labels: ['B&W','DUOTONE','CMYK'], default: 'cmyk' },
      { id: 'cellSize',    label: 'Screen',           type: 'slider', min: 3, max: 24, step: 1,   default: 10, unit: 'px', width: 'narrow' },
      { id: 'dotShape',    label: 'Dot Shape',        type: 'select', options: ['circle','diamond','line'], labels: ['●','◆','▬'], default: 'circle' },
      { id: 'paperColor',  label: 'Paper',            type: 'color',  default: '#f0ead8' },
      { id: 'masterAngle', label: 'Master Rotation',  type: 'slider', min: 0, max: 179, step: 1, default: 0,  unit: '°' },
      { id: 'angleK',      label: 'Angle K',          type: 'slider', min: 0, max: 179, step: 1, default: 45, unit: '°', width: 'narrow' },
      { id: 'angleC',      label: 'Angle C',          type: 'slider', min: 0, max: 179, step: 1, default: 15, unit: '°', width: 'narrow' },
      { id: 'angleM',      label: 'Angle M',          type: 'slider', min: 0, max: 179, step: 1, default: 75, unit: '°', width: 'narrow' },
      { id: 'angleY',      label: 'Angle Y',          type: 'slider', min: 0, max: 179, step: 1, default: 90, unit: '°', width: 'narrow' },
      { id: 'duotoneColor1', label: 'Color 1',        type: 'color',  default: '#1a1008' },
      { id: 'duotoneColor2', label: 'Color 2',        type: 'color',  default: '#d4890a' },
    ]
  },
  press: {
    id: 'press', group: 'PRINT', label: 'PRESS CONFIG', removable: false,
    desc: 'Master mechanical links: FEED aligns Bleed/Skip/Fibers. PRESSURE dictates mottling (requires Paper module).',
    params: [
      { id: 'feed',     label: 'Feed Direction',  type: 'feed-chip',     options: ['vertical','horizontal'], default: 'vertical', title: 'Locks the axis for Ink Bleed, Ink Skip banding, Paper Fibers, and Slur elongation.' },
      { id: 'laydown',  label: 'Ink Sequence',    type: 'laydown-chip',  options: ['k-c-m-y','y-m-c-k','c-m-y-k','m-c-y-k'], labels: ['K–C–M–Y','Y–M–C–K','C–M–Y–K','M–C–Y–K'], default: 'k-c-m-y', title: 'Physical laydown order. Determines which ink physically traps and obscures the layers beneath it.' },
      { id: 'pressure', label: 'Pressure',        type: 'pressure-roller', min: 0.1, max: 1.0, step: 0.05, default: 1.0, title: 'Reduces ink transfer in paper valleys (mottling). Requires Paper Texture > 0.' },
      { id: 'slur',     label: 'Slur Elongation', type: 'slur-chip',     min: 0, max: 0.5, step: 0.01, default: 0, title: 'Elongates dots exclusively along the Feed Direction due to blanket slippage.' },
    ]
  },
  dotgain: {
    id: 'dotgain', group: 'PRINT', label: 'DOT GAIN', removable: true,
    desc: 'Mechanical dot enlargement during impression. Midtones inflate non-linearly; shadow fill crushes deep blacks to solid.',
    params: [
      { id: 'amount', label: 'Gain',        type: 'slider', min: 0, max: 1.0, step: 0.01,  default: 0.25 },
      { id: 'shadow', label: 'Shadow Fill', type: 'slider', min: 0, max: 1,   step: 0.05, default: 0.3 },
    ]
  },
  registration: {
    id: 'registration', group: 'PRINT', label: 'REGISTRATION', removable: true,
    desc: 'Channel misalignment and lateral web stretch. Pads shift plates globally. Fan-Out expands later plates orthogonally.',
    params: [
      { id: 'c_xy',   label: 'CYAN',           type: 'xypad',  xId: 'cx', yId: 'cy', min: -15, max: 15, step: 0.5, color: '#00a0d8' },
      { id: 'm_xy',   label: 'MAGENTA',         type: 'xypad',  xId: 'mx', yId: 'my', min: -15, max: 15, step: 0.5, color: '#d8006a' },
      { id: 'y_xy',   label: 'YELLOW',          type: 'xypad',  xId: 'yx', yId: 'yy', min: -15, max: 15, step: 0.5, color: '#d8c800' },
      { id: 'fanout', label: 'Fan-Out Stretch', type: 'slider', min: 0,   max: 10,  step: 0.1, default: 0, unit: 'px' },
    ],
    extraDefaults: { cx: 0, cy: 0, mx: 0, my: 0, yx: 0, yy: 0, fanout: 0 },
  },
  inkskip: {
    id: 'inkskip', group: 'PRINT', label: 'INK SKIP', removable: true,
    desc: 'Roller starvation applied per plate. Voids are stretched along the feed direction to form continuous bands.',
    params: [
      { id: 'intensity', label: 'Intensity', type: 'slider', min: 0,    max: 1,   step: 0.01, default: 0.3 },
      { id: 'scale',     label: 'Scale',     type: 'slider', min: 0.05, max: 1,   step: 0.01, default: 0.4 },
    ]
  },
  paper: {
    id: 'paper', group: 'PRINT', label: 'PAPER TOOTH', removable: true,
    desc: 'Surface roughness of the paper stock. Cellulose streaks are structurally aligned to the feed direction.',
    params: [
      { id: 'texture', label: 'Texture', type: 'slider', min: 0, max: 0.5, step: 0.01, default: 0.15 },
      { id: 'fibers',  label: 'Fibers',  type: 'slider', min: 0, max: 0.5, step: 0.01, default: 0.05 },
    ]
  },
  inkbleed: {
    id: 'inkbleed', group: 'PRINT', label: 'INK BLEED', removable: true,
    desc: 'Ink wicking along paper fibers. Anisotropic settings cause ink to travel further along the structural grain.',
    params: [
      { id: 'radius',        label: 'Radius',        type: 'slider', min: 1, max: 16, step: 1,    default: 3,   unit: 'px', width: 'narrow' },
      { id: 'absorbency',    label: 'Absorbency',    type: 'slider', min: 0, max: 1,  step: 0.05, default: 0.8 },
      { id: 'directionality',label: 'Directionality',type: 'slider', min: 0, max: 1,  step: 0.05, default: 0.7 },
    ]
  },
  hickeys: {
    id: 'hickeys', group: 'PRINT', label: 'HICKEYS', removable: true,
    desc: 'Donut-shaped defects applied to individual plates, allowing other channels to print in the void.',
    params: [
      { id: 'count',   label: 'Count', type: 'slider', min: 1, max: 100, step: 1,  default: 12, width: 'narrow' },
      { id: 'sizeMax', label: 'Size',  type: 'slider', min: 3, max: 30,  step: 1,  default: 8,  unit: 'px', width: 'narrow' },
    ]
  },
};

const GROUP_ORDER = ['CAMERA', 'PRE-SCREEN', 'SCREEN', 'PRINT'];
const GROUP_MODULES = {
  'CAMERA':     ['filmstock'],
  'PRE-SCREEN': ['velox', 'grain'],
  'SCREEN':     ['halftone'],
  'PRINT':      ['press', 'dotgain', 'registration', 'inkskip', 'inkbleed', 'hickeys', 'paper'],
};

// ═══════════════════════════════════════════════════════════════════
// DATA ─ PRESETS
// ═══════════════════════════════════════════════════════════════════

const PRESETS = {
  '1963 NEWSPRINT': {
    active: ['filmstock','velox','grain','halftone','press','dotgain','registration','inkbleed','hickeys','paper'],
    params: {
      filmstock:    { stock: 'trix', exposure: 0.3, halation: 0.4, fade: 0.3 },
      halftone:     { mode: 'bw', cellSize: 14, masterAngle: 0, angleK: 45, dotShape: 'circle', paperColor: '#d6cdb4' },
      velox:        { threshold: 0.52, contrast: 2.0 },
      grain:        { amount: 0.12, weighted: 'on' },
      press:        { feed: 'vertical', laydown: 'k-c-m-y', pressure: 0.7, slur: 0.15 },
      dotgain:      { amount: 0.45, shadow: 0.4 },
      inkbleed:     { radius: 6.0, absorbency: 0.9, directionality: 0.7 },
      registration: { cx: 0, cy: 0, mx: 0, my: 0, yx: 0, yy: 0, fanout: 2.0 },
      hickeys:      { count: 18, sizeMax: 14 },
      paper:        { texture: 0.35, fibers: 0.25 },
    }
  },
  '1975 OFFSET ZINE': {
    active: ['filmstock','grain','halftone','press','dotgain','registration','inkskip','inkbleed','hickeys','paper'],
    params: {
      filmstock:    { stock: 'ektachrome', exposure: 0, halation: 0.5, fade: 0.15 },
      halftone:     { mode: 'cmyk', cellSize: 14, masterAngle: 0, angleK: 45, angleC: 15, angleM: 75, angleY: 90, dotShape: 'circle', paperColor: '#ede0c4' },
      grain:        { amount: 0.07, weighted: 'on' },
      press:        { feed: 'horizontal', laydown: 'y-m-c-k', pressure: 0.85, slur: 0.05 },
      dotgain:      { amount: 0.32, shadow: 0.3 },
      registration: { cx: 2.5, cy: 1.0, mx: -0.5, my: 0.5, yx: -1.5, yy: -0.5, fanout: 1.5 },
      inkskip:      { intensity: 0.4, scale: 0.5 },
      inkbleed:     { radius: 3.0, absorbency: 0.65, directionality: 0.4 },
      hickeys:      { count: 25, sizeMax: 8 },
      paper:        { texture: 0.14, fibers: 0.15 },
    }
  },
  '1985 MAGAZINE': {
    active: ['filmstock','halftone','press','dotgain'],
    params: {
      filmstock: { stock: 'kodachrome', exposure: 0, halation: 0.4, fade: 0 },
      halftone:  { mode: 'cmyk', cellSize: 7, masterAngle: 0, angleK: 45, angleC: 15, angleM: 75, angleY: 90, dotShape: 'circle', paperColor: '#f8f5ef' },
      press:     { feed: 'vertical', laydown: 'k-c-m-y', pressure: 1.0, slur: 0 },
      dotgain:   { amount: 0.13, shadow: 0.1 },
    }
  },
  'VELOX STATS': {
    active: ['filmstock','velox','halftone','press','dotgain'],
    params: {
      filmstock: { stock: 'hp5', exposure: 0, halation: 0.2, fade: 0 },
      halftone:  { mode: 'bw', cellSize: 11, masterAngle: 0, angleK: 45, dotShape: 'circle', paperColor: '#f4efea' },
      velox:     { threshold: 0.47, contrast: 3.0 },
      press:     { feed: 'vertical', laydown: 'k-c-m-y', pressure: 1.0, slur: 0 },
      dotgain:   { amount: 0.18, shadow: 0.2 },
    }
  },
  'RISOGRAPH': {
    active: ['halftone','press','dotgain','registration','inkskip'],
    params: {
      halftone:     { mode: 'duotone', cellSize: 11, masterAngle: 0, angleK: 55, angleC: 80, dotShape: 'circle', duotoneColor1: '#1e3a8a', duotoneColor2: '#e8402a', paperColor: '#f7f0e6' },
      press:        { feed: 'vertical', laydown: 'k-c-m-y', pressure: 0.9, slur: 0.08 },
      dotgain:      { amount: 0.2, shadow: 0.15 },
      registration: { cx: 2.5, cy: -1.5, mx: 0, my: 0, yx: 0, yy: 0, fanout: 0 },
      inkskip:      { intensity: 0.3, scale: 0.2 },
    }
  },
  'CMYK CLEAN': {
    active: ['halftone','press'],
    params: {
      halftone: { mode: 'cmyk', cellSize: 9, masterAngle: 0, angleK: 45, angleC: 15, angleM: 75, angleY: 90, dotShape: 'circle', paperColor: '#ffffff' },
      press:    { feed: 'vertical', laydown: 'k-c-m-y', pressure: 1.0, slur: 0 },
    }
  },
};
