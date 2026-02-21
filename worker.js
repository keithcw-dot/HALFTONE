// ─── WHY A WORKER? ───────────────────────────────────────────────
// All pixel-level processing (halftone dot rendering, ink bleed
// convolution, film curve LUTs, etc.) runs here, off the main thread.
// Without this, every slider drag would freeze the UI for the full
// render duration — potentially hundreds of ms on large images.
//
// ─── MESSAGE PROTOCOL ────────────────────────────────────────────
// Main → Worker (via postMessage + transfer):
//   { taskId, bitmap, activeModulesList, moduleParams,
//     forExport, previewMaxPx, upscale }
//   bitmap is transferred (zero-copy) as an ImageBitmap.
//
// Worker → Main:
//   { taskId, resultBitmap }
//   resultBitmap is transferred back as an ImageBitmap.
//
// taskId values:
//   'preview' — debounced live render, capped to previewMaxPx
//   'loupe'   — full-res render for the 2× loupe inspector
//   'export'  — full-res render with optional upscale, triggers download
//
// ─── PIPELINE ORDER ──────────────────────────────────────────────
// 1. Upscale (export only)
// 2. Film Stock  (applyFilmStock)    — curves, halation, B&W, fade
// 3. Velox       (applyVelox)        — high-contrast sigmoid crush
// 4. Film Grain  (applyGrain)        — per-pixel noise
// 5. Halftone    (renderPlate ×N)    — dot grid per channel/plate
// 6. Ink Bleed   (applyInkBleed)     — directional ink wicking
// 7. Paper Tooth (inline)            — surface texture + pressure mottling
// ─────────────────────────────────────────────────────────────────

// Pre-computed universal Luminance multipliers mapped 0-255
const LUM_R = new Float32Array(256);
const LUM_G = new Float32Array(256);
const LUM_B = new Float32Array(256);
for(let i = 0; i < 256; i++) {
  LUM_R[i] = i * 0.299;
  LUM_G[i] = i * 0.587;
  LUM_B[i] = i * 0.114;
}

const FILM_STOCKS = {
  trix: {
    name: 'TRI-X 400', bw: true,
    curves: { r: { black: 0.02, shadows: 0.14, midtone: 0.52, highlights: 0.85, white: 0.98 }, g: { black: 0.02, shadows: 0.14, midtone: 0.52, highlights: 0.85, white: 0.98 }, b: { black: 0.02, shadows: 0.14, midtone: 0.52, highlights: 0.85, white: 0.98 } },
    saturation: 0, bwWeights: [0.35, 0.50, 0.15], halation: { radius: 4, tint: [200, 200, 200], strength: 0.06 },
  },
  hp5: {
    name: 'HP5 PLUS 400', bw: true,
    curves: { r: { black: 0.03, shadows: 0.19, midtone: 0.50, highlights: 0.80, white: 0.96 }, g: { black: 0.03, shadows: 0.19, midtone: 0.50, highlights: 0.80, white: 0.96 }, b: { black: 0.03, shadows: 0.19, midtone: 0.50, highlights: 0.80, white: 0.96 } },
    saturation: 0, bwWeights: [0.30, 0.55, 0.15], halation: { radius: 4, tint: [200, 200, 200], strength: 0.04 },
  },
  kodachrome: {
    name: 'KODACHROME 64', bw: false,
    curves: { r: { black: 0.03, shadows: 0.22, midtone: 0.55, highlights: 0.83, white: 0.97 }, g: { black: 0.02, shadows: 0.17, midtone: 0.48, highlights: 0.78, white: 0.95 }, b: { black: 0.01, shadows: 0.12, midtone: 0.40, highlights: 0.72, white: 0.92 } },
    saturation: 1.35, halation: { radius: 8, tint: [255, 160, 80], strength: 0.15 },
  },
  portra: {
    name: 'PORTRA 400', bw: false,
    curves: { r: { black: 0.06, shadows: 0.24, midtone: 0.52, highlights: 0.78, white: 0.94 }, g: { black: 0.05, shadows: 0.22, midtone: 0.50, highlights: 0.76, white: 0.93 }, b: { black: 0.04, shadows: 0.19, midtone: 0.46, highlights: 0.73, white: 0.91 } },
    saturation: 0.88, halation: { radius: 10, tint: [255, 190, 130], strength: 0.12 },
  },
  ektachrome: {
    name: 'EKTACHROME 100', bw: false,
    curves: { r: { black: 0.02, shadows: 0.19, midtone: 0.50, highlights: 0.80, white: 0.96 }, g: { black: 0.02, shadows: 0.20, midtone: 0.52, highlights: 0.82, white: 0.97 }, b: { black: 0.03, shadows: 0.22, midtone: 0.53, highlights: 0.82, white: 0.97 } },
    saturation: 1.15, halation: { radius: 6, tint: [240, 180, 110], strength: 0.08 },
  },
};

function copyCanvas(src) {
  const dst = new OffscreenCanvas(src.width, src.height);
  dst.getContext('2d').drawImage(src, 0, 0);
  return dst;
}

function getPreviewCanvas(sourceCanvas, maxPx) {
  const w = sourceCanvas.width, h = sourceCanvas.height;
  const maxDim = Math.max(w, h);
  if (maxDim <= maxPx) return copyCanvas(sourceCanvas);
  const scale = maxPx / maxDim;
  const dst = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale));
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, dst.width, dst.height);
  return dst;
}

function applyUpscale(canvas, params) {
  const scale = Math.round(params.scale);
  if (scale <= 1) return canvas;
  const dst = new OffscreenCanvas(canvas.width * scale, canvas.height * scale);
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, dst.width, dst.height);
  return dst;
}

// Pre-bakes Exposure into the LUT to save an entire array loop later
function buildCurveLUT(curve, exposure) {
  const lut = new Uint8Array(256);
  const pts = [{ x: 0, y: curve.black }, { x: 0.25, y: curve.shadows }, { x: 0.5, y: curve.midtone }, { x: 0.75, y: curve.highlights }, { x: 1.0, y: curve.white }];
  for (let i = 0; i < 256; i++) {
    // Exposure shift calculated prior to curve mapping
    const expVal = Math.max(0, Math.min(255, i * exposure));
    const x = expVal / 255; 
    let s = 0;
    for (let j = 0; j < pts.length - 1; j++) { if (x <= pts[j + 1].x) { s = j; break; } if (j === pts.length - 2) s = j; }
    const p0 = pts[s], p1 = pts[s + 1];
    let t = p1.x > p0.x ? (x - p0.x) / (p1.x - p0.x) : 0;
    t = t * t * (3 - 2 * t);
    // Uint8Array implicitly handles the clamping/rounding, but we ensure positive range explicitly
    lut[i] = Math.max(0, Math.min(255, Math.round((p0.y + t * (p1.y - p0.y)) * 255)));
  }
  return lut;
}

function boxBlur2D(data, w, h, radius) {
  let src = new Float32Array(data);
  let tmp = new Float32Array(w * h);
  const r = Math.round(radius);
  if (r < 1) return src;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0, count = 0;
      for (let bx = 0; bx <= r && bx < w; bx++) { sum += src[y * w + bx]; count++; }
      tmp[y * w] = sum / count;
      for (let x = 1; x < w; x++) {
        if (x + r < w) { sum += src[y * w + x + r]; count++; }
        if (x - r - 1 >= 0) { sum -= src[y * w + x - r - 1]; count--; }
        tmp[y * w + x] = sum / count;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let by = 0; by <= r && by < h; by++) { sum += tmp[by * w + x]; count++; }
      src[x] = sum / count;
      for (let y = 1; y < h; y++) {
        if (y + r < h) { sum += tmp[(y + r) * w + x]; count++; }
        if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]; count--; }
        src[y * w + x] = sum / count;
      }
    }
  }
  return src;
}

function applyFilmStock(canvas, params) {
  const stock = FILM_STOCKS[params.stock];
  if (!stock) return canvas;
  const dst = copyCanvas(canvas);
  const ctx = dst.getContext('2d');
  const imgData = ctx.getImageData(0, 0, dst.width, dst.height);
  const d = imgData.data; // Note: Uint8ClampedArray handles out-of-bounds auto-clamping
  const w = dst.width, h = dst.height;
  
  const exposure = Math.pow(2, params.exposure);
  const halMul = params.halation;
  const halStrength = halMul * stock.halation.strength;
  const fade = params.fade;
  
  const lutR = buildCurveLUT(stock.curves.r, exposure);
  const lutG = buildCurveLUT(stock.curves.g, exposure);
  const lutB = buildCurveLUT(stock.curves.b, exposure);

  if (halStrength > 0.005) {
    const tint = stock.halation.tint;
    const radius = stock.halation.radius;
    const threshold = 0.65;
    const bright = new Float32Array(w * h);
    
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const lum = (LUM_R[d[i]] + LUM_G[d[i+1]] + LUM_B[d[i+2]]) / 255;
      bright[j] = lum > threshold ? (lum - threshold) / (1 - threshold) : 0;
    }
    const glow = boxBlur2D(bright, w, h, radius);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const g = glow[j] * halStrength;
      if (g > 0.001) {
        d[i]   += g * tint[0];
        d[i+1] += g * tint[1];
        d[i+2] += g * tint[2];
      }
    }
  }

  // Applies exposure mapping AND contrast curves in a single pass via LUT
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = lutR[d[i]];
    d[i+1] = lutG[d[i+1]];
    d[i+2] = lutB[d[i+2]];
  }

  if (stock.bw && stock.bwWeights) {
    const [wr, wg, wb] = stock.bwWeights;
    const BW_R = new Float32Array(256), BW_G = new Float32Array(256), BW_B = new Float32Array(256);
    for(let i=0; i<256; i++) { BW_R[i] = i * wr; BW_G[i] = i * wg; BW_B[i] = i * wb; }
    
    for (let i = 0; i < d.length; i += 4) {
      const lum = BW_R[d[i]] + BW_G[d[i+1]] + BW_B[d[i+2]];
      d[i] = d[i+1] = d[i+2] = lum;
    }
  }

  if (!stock.bw && stock.saturation !== 1) {
    const sat = stock.saturation;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      const lum = LUM_R[r] + LUM_G[g] + LUM_B[b];
      d[i]   = lum + (r - lum) * sat;
      d[i+1] = lum + (g - lum) * sat;
      d[i+2] = lum + (b - lum) * sat;
    }
  }

  if (fade > 0.01) {
    const rScale = stock.bw ? 1 : 1 + fade * 0.14;
    const gScale = stock.bw ? 1 : 1 + fade * 0.03;
    const bScale = stock.bw ? 1 : 1 - fade * 0.08;
    const contrast = 1 - fade * 0.22;
    const lift = fade * 0.07;
    const desat = fade * 0.35;

    // Pre-compute fade matrix math into 1D LUT arrays (mapping 0-255 into 0.0-1.0 range)
    const FADE_R = new Float32Array(256);
    const FADE_G = new Float32Array(256);
    const FADE_B = new Float32Array(256);
    for(let i=0; i<256; i++) {
        FADE_R[i] = lift + (i / 255) * rScale * contrast;
        FADE_G[i] = lift + (i / 255) * gScale * contrast;
        FADE_B[i] = lift + (i / 255) * bScale * contrast;
    }

    for (let i = 0; i < d.length; i += 4) {
      const r = FADE_R[d[i]], g = FADE_G[d[i+1]], b = FADE_B[d[i+2]];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      d[i]   = (r + (lum - r) * desat) * 255;
      d[i+1] = (g + (lum - g) * desat) * 255;
      d[i+2] = (b + (lum - b) * desat) * 255;
    }
  }
  
  ctx.putImageData(imgData, 0, 0);
  return dst;
}

function applyVelox(canvas, params) {
  const dst = copyCanvas(canvas);
  const ctx = dst.getContext('2d');
  const id = ctx.getImageData(0, 0, dst.width, dst.height);
  const d = id.data;
  const t = params.threshold;
  const c = params.contrast;

  // Pre-calculate the heavy Math.exp operation into a Sigmoid LUT
  const veloxLUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let l = i / 255;
    l = 1 / (1 + Math.exp(-(l - t) * c * 10));
    veloxLUT[i] = Math.max(0, Math.min(255, Math.round(l * 255)));
  }

  for (let i = 0; i < d.length; i += 4) {
    const lumInt = Math.round(LUM_R[d[i]] + LUM_G[d[i+1]] + LUM_B[d[i+2]]);
    const v = veloxLUT[lumInt];
    d[i] = d[i+1] = d[i+2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return dst;
}

function applyGrain(canvas, params) {
  const dst = copyCanvas(canvas);
  const ctx = dst.getContext('2d');
  const id = ctx.getImageData(0, 0, dst.width, dst.height);
  const d = id.data;
  const amt = params.amount;
  const weighted = params.weighted === 'on';
  const noiseMax = 2 * amt * 255;

  for (let i = 0; i < d.length; i += 4) {
    const lum = LUM_R[d[i]] + LUM_G[d[i+1]] + LUM_B[d[i+2]];
    const weight = weighted ? (1 - lum / 255) * 1.5 : 1;
    const noise = (Math.random() - 0.5) * noiseMax * weight;
    d[i]   += noise;
    d[i+1] += noise;
    d[i+2] += noise;
  }
  ctx.putImageData(id, 0, 0);
  return dst;
}

function buildInkSkipMap(w, h, intensity, scale, seedOffset, feedDir) {
  const map = new Float32Array(w * h);
  const blobCount = Math.max(3, Math.round((1 - scale) * 12 + 3));
  const adjustedBlobCount = blobCount * 3; 
  const baseRadius = scale * Math.min(w, h) * 0.6;
  const blobs = [];
  
  const random = (seed) => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  let seed = seedOffset * 1000;

  for (let i = 0; i < adjustedBlobCount; i++) {
    const rX = feedDir === 'vertical' ? baseRadius * 0.15 : baseRadius * 2.5;
    const rY = feedDir === 'vertical' ? baseRadius * 2.5 : baseRadius * 0.15;
    blobs.push({
      x: random(seed++) * w, y: random(seed++) * h,
      rx: rX * (0.5 + random(seed++)),
      ry: rY * (0.5 + random(seed++)),
      v: (random(seed++) - 0.5) * 2 * intensity,
    });
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, wsum = 0;
      for (const b of blobs) {
        const dx = x - b.x;
        const dy = y - b.y;
        const dist = Math.sqrt((dx*dx)/(b.rx*b.rx) + (dy*dy)/(b.ry*b.ry));
        if (dist < 1) {
          const w2 = 1 - dist;
          sum += b.v * w2; wsum += w2;
        }
      }
      if (wsum > 0) {
          const v = sum / wsum;
          map[y * w + x] = Math.max(-intensity, Math.min(intensity, v));
      } else {
          map[y * w + x] = 0;
      }
    }
  }
  return map;
}

function buildPaperMap(w, h, texture, fibers, feedDir) {
  const map = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      map[y * w + x] = (Math.random() - 0.5) * 2 * texture;
    }
  }
  if (fibers > 0) {
    const fiberCount = Math.round(Math.max(w, h) * fibers * 0.3);
    for (let f = 0; f < fiberCount; f++) {
      const fy = Math.floor(Math.random() * h);
      const fx = Math.floor(Math.random() * w);
      const fLen = Math.floor(Math.random() * Math.max(w,h) * 0.2) + 10;
      const fVal = (Math.random() - 0.5) * fibers * 2;
      if (feedDir === 'horizontal') {
        for (let dx = 0; dx < fLen && fx + dx < w; dx++) {
          const falloff = 1 - dx / fLen;
          map[fy * w + fx + dx] += fVal * falloff;
        }
      } else {
        for (let dy = 0; dy < fLen && fy + dy < h; dy++) {
          const falloff = 1 - dy / fLen;
          map[(fy + dy) * w + fx] += fVal * falloff;
        }
      }
    }
  }
  return map;
}

function parseCSSColor(hex) {
  const c = hex.replace('#', '');
  return [ parseInt(c.substring(0, 2), 16), parseInt(c.substring(2, 4), 16), parseInt(c.substring(4, 6), 16) ];
}

function applyPlateHickeys(ctx, w, h, params, inkColorHex, plateIndex) {
  const count = Math.round(params.count);
  const sizeMax = params.sizeMax;
  if (count < 1 || sizeMax < 2) return;
  
  const inkRGB = parseCSSColor(inkColorHex);
  const darken = 0.6;
  const ringR = Math.max(0, Math.min(255, Math.round(inkRGB[0] * darken)));
  const ringG = Math.max(0, Math.min(255, Math.round(inkRGB[1] * darken)));
  const ringB = Math.max(0, Math.min(255, Math.round(inkRGB[2] * darken)));

  const random = (seed) => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  let seed = plateIndex * 5000;

  for (let i = 0; i < count; i++) {
    const x = random(seed++) * w; 
    const y = random(seed++) * h;
    const outerR = 2 + random(seed++) * (sizeMax - 2);
    const innerR = outerR * (0.35 + random(seed++) * 0.25);
    
    ctx.beginPath(); ctx.arc(x, y, outerR, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${ringR},${ringG},${ringB})`; ctx.fill();
    
    ctx.beginPath(); ctx.arc(x, y, innerR, 0, Math.PI * 2);
    ctx.fillStyle = `#ffffff`; ctx.fill();
  }
}

function renderPlate(srcData, w, h, opts) {
  const plate = new OffscreenCanvas(w, h);
  const pCtx = plate.getContext('2d');
  
  pCtx.fillStyle = '#ffffff';
  pCtx.fillRect(0, 0, w, h);

  const { color, angleDeg, offsetX, offsetY, dotGain, shadowFill, dotShape, cellSize, getValue, inkSkipMap, fanout, feedDir, slur, plateIndex } = opts;
  const cx = w / 2, cy = h / 2;
  const rad = angleDeg * Math.PI / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);

  pCtx.fillStyle = color;

  // Lateral expansion matrix for Fan-Out
  const maxStretch = (fanout || 0) * ((plateIndex - 1) / 3);
  const stretchFactorX = feedDir === 'vertical' ? maxStretch / (w / 2) : 0;
  const stretchFactorY = feedDir === 'horizontal' ? maxStretch / (h / 2) : 0;

  // Slur scaling matrix
  const scaleX = feedDir === 'horizontal' ? 1 + (slur || 0) : 1;
  const scaleY = feedDir === 'vertical' ? 1 + (slur || 0) : 1;

  const halfDiag = Math.ceil(Math.sqrt(w * w + h * h) / 2) + cellSize;
  for (let gy = -halfDiag; gy < halfDiag; gy += cellSize) {
    for (let gx = -halfDiag; gx < halfDiag; gx += cellSize) {
      const gcx = gx + cellSize * 0.5, gcy = gy + cellSize * 0.5;
      const imgX = cx + gcx * cosA - gcy * sinA;
      const imgY = cy + gcx * sinA + gcy * cosA;

      if (imgX < 0 || imgX >= w || imgY < 0 || imgY >= h) continue;
      const sx = Math.max(0, Math.min(w - 1, Math.round(imgX))), sy = Math.max(0, Math.min(h - 1, Math.round(imgY)));
      const idx = (sy * w + sx) * 4;

      let ink = Math.max(0, Math.min(1, getValue(srcData.data[idx], srcData.data[idx+1], srcData.data[idx+2])));
      ink = ink + dotGain * ink * (1 - ink) * 2;
      if (ink > 0.75 && shadowFill > 0) ink = ink + (1 - ink) * shadowFill * ((ink - 0.75) / 0.25);
      ink = Math.max(0, Math.min(1, ink));

      if (inkSkipMap) ink = Math.max(0, Math.min(1, ink * (1 - (inkSkipMap[sy * w + sx] || 0))));
      const maxR = (cellSize * 0.5) * 0.98;
      const radius = maxR * Math.sqrt(ink);
      if (radius < 0.3) continue;

      // Apply global offset PLUS additive lateral fan-out stretch
      const dx = imgX + offsetX + ((imgX - cx) * stretchFactorX);
      const dy = imgY + offsetY + ((imgY - cy) * stretchFactorY);

      pCtx.save();
      pCtx.translate(dx, dy);
      if (slur > 0) pCtx.scale(scaleX, scaleY);
      
      pCtx.beginPath();
      if (dotShape === 'diamond') {
        pCtx.moveTo(0, -radius); pCtx.lineTo(radius, 0);
        pCtx.lineTo(0, radius); pCtx.lineTo(-radius, 0);
        pCtx.closePath();
      } else if (dotShape === 'line') {
        const lw = Math.max(0.3, Math.min(maxR, radius * 1.2));
        pCtx.rotate(rad);
        pCtx.rect(-cellSize * 0.5, -lw * 0.5, cellSize, lw);
      } else {
        pCtx.arc(0, 0, radius, 0, Math.PI * 2);
      }
      pCtx.fill();
      pCtx.restore();
    }
  }

  if (opts.hickeys) {
    applyPlateHickeys(pCtx, w, h, opts.hickeys, color, plateIndex);
  }

  return plate;
}

function applyInkBleed(ctx, w, h, params, paperColor, feedDir) {
  const radius = Math.round(params.radius);
  if (radius < 1) return;
  const absorbency = params.absorbency;
  const dir = params.directionality || 0;
  
  // Bleed angle is strictly locked to paper grain orientation.
  const ang = feedDir === 'vertical' ? Math.PI / 2 : 0;

  const imgData = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  const pc = parseCSSColor(paperColor);

  const density = new Float32Array(w * h);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    const dr = (src[i] - pc[0]) / 255;
    const dg = (src[i+1] - pc[1]) / 255;
    const db = (src[i+2] - pc[2]) / 255;
    const val = 1 - (1 + dr*0.299 + dg*0.587 + db*0.114);
    density[j] = Math.max(0, Math.min(1, val));
  }

  const kernel = [];
  let kSum = 0;
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  const stretch = Math.max(0.1, 1 - dir); 

  for(let y = -radius; y <= radius; y++) {
    for(let x = -radius; x <= radius; x++) {
      const rx = x * cosA - y * sinA;
      const ry = x * sinA + y * cosA;
      const dist = Math.sqrt(rx*rx + (ry/stretch)*(ry/stretch));
      if(dist <= radius) {
        const weight = 1 - (dist / radius);
        kernel.push({ dx: x, dy: y, w: weight });
        kSum += weight;
      }
    }
  }

  const blurDensity = new Float32Array(w * h);
  const blurR = new Float32Array(w * h);
  const blurG = new Float32Array(w * h);
  const blurB = new Float32Array(w * h);

  for(let y = 0; y < h; y++) {
    for(let x = 0; x < w; x++) {
      let sD = 0, sR = 0, sG = 0, sB = 0;
      for(let k = 0; k < kernel.length; k++) {
        const px = Math.max(0, Math.min(w - 1, x + kernel[k].dx));
        const py = Math.max(0, Math.min(h - 1, y + kernel[k].dy));
        const i1D = py * w + px;
        const i3D = i1D * 4;
        const kw = kernel[k].w;
        sD += density[i1D] * kw;
        sR += src[i3D] * kw;
        sG += src[i3D+1] * kw;
        sB += src[i3D+2] * kw;
      }
      const outIdx = y * w + x;
      blurDensity[outIdx] = sD / kSum;
      blurR[outIdx] = sR / kSum;
      blurG[outIdx] = sG / kSum;
      blurB[outIdx] = sB / kSum;
    }
  }

  // Pre-calculated square root lookup table for non-linear density scaling
  const densityLUT = new Float32Array(1024);
  for(let i=0; i<1024; i++) {
      densityLUT[i] = Math.sqrt(i / 1023);
  }

  for (let i = 0, j = 0; i < dst.length; i += 4, j++) {
    const idx = Math.min(1023, Math.max(0, blurDensity[j] * 1023)) | 0; // Bitwise OR truncation for speed
    const densityCurve = densityLUT[idx];
    const blend = Math.max(0, Math.min(1, densityCurve * absorbency * 1.5));
    
    dst[i]   = src[i]   + (blurR[j] - src[i])   * blend;
    dst[i+1] = src[i+1] + (blurG[j] - src[i+1]) * blend;
    dst[i+2] = src[i+2] + (blurB[j] - src[i+2]) * blend;
  }
  ctx.putImageData(imgData, 0, 0);
}

self.onmessage = async function(e) {
  const { taskId, bitmap, activeModulesList, moduleParams, forExport, previewMaxPx, upscale } = e.data;
  const active = new Set(activeModulesList);
  const P = moduleParams;
  const feedDir = P.press ? P.press.feed : 'vertical';

  let sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  sourceCanvas.getContext('2d').drawImage(bitmap, 0, 0);

  let canvas = forExport ? sourceCanvas : getPreviewCanvas(sourceCanvas, previewMaxPx);

  if (forExport && upscale > 1) {
    canvas = applyUpscale(canvas, { scale: upscale });
  }

  if (active.has('filmstock')) canvas = applyFilmStock(canvas, P.filmstock);
  if (active.has('velox')) canvas = applyVelox(canvas, P.velox);
  if (active.has('grain')) canvas = applyGrain(canvas, P.grain);

  const w = canvas.width, h = canvas.height;
  const srcData = canvas.getContext('2d').getImageData(0, 0, w, h);

  const ht = P.halftone;
  const cellSize = ht.cellSize;
  const mode = ht.mode;
  const dotShape = ht.dotShape || 'circle';
  const mAng = ht.masterAngle || 0;

  const dg = active.has('dotgain') ? P.dotgain : { amount: 0, shadow: 0 };
  const reg = active.has('registration') ? P.registration : { cx:0,cy:0,mx:0,my:0,yx:0,yy:0, fanout: 0 };
  const hickeysConf = active.has('hickeys') ? P.hickeys : null;

  const cmykGet = {
    c: (r,g,b) => { const R=r/255,G=g/255,B=b/255,K=1-Math.max(R,G,B); return K>=1?0:(1-R-K)/(1-K); },
    m: (r,g,b) => { const R=r/255,G=g/255,B=b/255,K=1-Math.max(R,G,B); return K>=1?0:(1-G-K)/(1-K); },
    y: (r,g,b) => { const R=r/255,G=g/255,B=b/255,K=1-Math.max(R,G,B); return K>=1?0:(1-B-K)/(1-K); },
    k: (r,g,b) => 1-Math.max(r/255,g/255,b/255),
    lum: (r,g,b) => (LUM_R[r] + LUM_G[g] + LUM_B[b]) / 255,
  };

  let channels = [];
  if (mode === 'bw') {
    channels = [{ id: 'k', color: ht.duotoneColor1 || '#000000', angleDeg: ht.angleK + mAng, offsetX: 0, offsetY: 0, getValue: (r,g,b) => 1 - cmykGet.lum(r,g,b) }];
  } else if (mode === 'duotone') {
    channels = [
      { id: '2', color: ht.duotoneColor2, angleDeg: ht.angleC + mAng, offsetX: reg.cx, offsetY: reg.cy, getValue: cmykGet.lum },
      { id: '1', color: ht.duotoneColor1, angleDeg: ht.angleK + mAng, offsetX: 0, offsetY: 0, getValue: (r,g,b) => 1 - cmykGet.lum(r,g,b) },
    ];
  } else {
    channels = [
      { id: 'c', color: '#009fce', angleDeg: ht.angleC + mAng, offsetX: reg.cx, offsetY: reg.cy, getValue: cmykGet.c },
      { id: 'm', color: '#d4006a', angleDeg: ht.angleM + mAng, offsetX: reg.mx, offsetY: reg.my, getValue: cmykGet.m },
      { id: 'y', color: '#f5d800', angleDeg: ht.angleY + mAng, offsetX: reg.yx, offsetY: reg.yy, getValue: cmykGet.y },
      { id: 'k', color: '#100c08', angleDeg: ht.angleK + mAng, offsetX: 0, offsetY: 0, getValue: cmykGet.k },
    ];
    
    // Sort CMYK sequence dynamically based on laydown configuration
    const laydown = P.press ? P.press.laydown : 'k-c-m-y';
    const order = laydown.split('-');
    channels.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d');
  
  ctx.fillStyle = ht.paperColor;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'multiply';

  channels.forEach((ch, index) => {
    let inkSkipMap = null;
    if (active.has('inkskip')) {
      inkSkipMap = buildInkSkipMap(w, h, P.inkskip.intensity, P.inkskip.scale, index + 1, feedDir);
    }
    
    const plate = renderPlate(srcData, w, h, { 
      ...ch, 
      dotGain: dg.amount, 
      shadowFill: dg.shadow, 
      dotShape, 
      cellSize, 
      inkSkipMap,
      hickeys: hickeysConf,
      fanout: reg.fanout,
      feedDir: feedDir,
      slur: P.press ? P.press.slur : 0,
      plateIndex: index + 1
    });
    
    ctx.drawImage(plate, 0, 0);
  });
  
  ctx.globalCompositeOperation = 'source-over';

  if (active.has('inkbleed')) applyInkBleed(ctx, w, h, P.inkbleed, ht.paperColor, feedDir);

  if (active.has('paper')) {
    const pp = P.paper;
    const pressure = P.press ? P.press.pressure : 1.0;
    const outData = ctx.getImageData(0, 0, w, h);
    const od = outData.data;
    const paperMap = buildPaperMap(w, h, pp.texture, pp.fibers, feedDir);
    const pc = parseCSSColor(ht.paperColor);

    for (let i = 0, j = 0; i < od.length; i += 4, j++) {
      const lum = (LUM_R[od[i]] + LUM_G[od[i+1]] + LUM_B[od[i+2]]) / 255;
      const pVal = paperMap[j];

      if (lum > 0.4) {
        const hw = Math.max(0, Math.min(1, (lum - 0.4) / 0.6));
        const noise = pVal * hw * 150;
        od[i]   += noise;
        od[i+1] += noise;
        od[i+2] += noise;
      }

      // Subtract ink in shadow regions when impression pressure is low to simulate mottling
      if (pressure < 1.0 && lum < 0.6 && pVal > 0) {
        const sw = Math.max(0, Math.min(1, (0.6 - lum) / 0.6));
        const safeTexture = Math.max(0.001, pp.texture);
        const mottleStrength = Math.max(0, Math.min(1, (1 - pressure) * (pVal / safeTexture) * sw * 2.0));
        od[i]   += (pc[0] - od[i]) * mottleStrength;
        od[i+1] += (pc[1] - od[i+1]) * mottleStrength;
        od[i+2] += (pc[2] - od[i+2]) * mottleStrength;
      }
    }
    ctx.putImageData(outData, 0, 0);
  }

  const outBmp = await createImageBitmap(out);
  self.postMessage({ taskId, resultBitmap: outBmp }, [outBmp]);
};
