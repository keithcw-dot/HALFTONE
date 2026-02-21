// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

const state = {
  sourceImage: null, sourceCanvas: null, processedCanvas: null,
  activeModules: new Set(['halftone', 'press']),
  moduleParams: {},
  activePanel: null,
  splitX: 0.5, draggingSplit: false, draggingLoupe: false,
  exportUpscale: 1,
  hqPreview: false, prev2x: false,
  loupeActive: false, loupeFullRes: null, loupeDirty: true,
  t0: 0
};

// Seed each module's params from its definition defaults
for (const [id, def] of Object.entries(MODULE_DEFS)) {
  state.moduleParams[id] = {};
  for (const p of def.params) if (p.default !== undefined) state.moduleParams[id][p.id] = p.default;
  if (def.extraDefaults) Object.assign(state.moduleParams[id], def.extraDefaults);
}

function imageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

// ═══════════════════════════════════════════════════════════════════
// WORKER ─ SETUP & MESSAGE ROUTING
// ═══════════════════════════════════════════════════════════════════

const renderWorker = new Worker('./worker.js');

renderWorker.onmessage = function(e) {
  const { taskId, resultBitmap } = e.data;
  const canvas = document.createElement('canvas');
  canvas.width = resultBitmap.width; canvas.height = resultBitmap.height;
  canvas.getContext('2d').drawImage(resultBitmap, 0, 0);

  if (taskId === 'preview') {
    state.processedCanvas = canvas;
    document.getElementById('render-status').textContent = `${Math.round(performance.now() - state.t0)}ms`;
    document.getElementById('processing').classList.remove('visible');
    drawSplit();
  } else if (taskId === 'loupe') {
    state.loupeFullRes = canvas;
    state.loupeDirty = false;
    document.getElementById('render-status').textContent = 'LOUPE OK';
    setTimeout(() => { document.getElementById('render-status').textContent = ''; }, 1200);
  } else if (taskId === 'export') {
    const link = document.createElement('a');
    link.download = 'halftone_' + Date.now() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    document.getElementById('render-status').textContent = 'EXPORTED';
    document.getElementById('processing').classList.remove('visible');
  }
};

let renderTimeout = null;

function scheduleRender() {
  if (!state.sourceImage) return;
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(triggerRender, 250);
}

function dispatchWorkerTask(taskId, opts = {}) {
  if (!state.sourceCanvas) return;
  createImageBitmap(state.sourceCanvas).then(bitmap => {
    let previewMaxPx = 900;
    if (state.hqPreview) previewMaxPx = 99999;
    else if (state.prev2x) previewMaxPx = 1800;
    renderWorker.postMessage({
      taskId, bitmap,
      activeModulesList: Array.from(state.activeModules),
      moduleParams: JSON.parse(JSON.stringify(state.moduleParams)),
      previewMaxPx, ...opts
    }, [bitmap]);
  });
}

function triggerRender() {
  if (!state.sourceCanvas) return;
  clearTimeout(renderTimeout);
  state.loupeDirty = true;
  state.t0 = performance.now();
  document.getElementById('render-status').textContent = 'RENDERING…';
  document.getElementById('processing').classList.add('visible');
  dispatchWorkerTask('preview', { forExport: false, upscale: 1 });
}

function renderLoupeCache() {
  if (!state.sourceCanvas) return;
  document.getElementById('render-status').textContent = 'LOUPE…';
  dispatchWorkerTask('loupe', { forExport: false, previewMaxPx: 99999, upscale: 1 });
}

function exportImage() {
  if (!state.sourceCanvas) { alert('No image loaded.'); return; }
  document.getElementById('export-dropdown').classList.remove('open');
  document.getElementById('render-status').textContent = 'EXPORTING…';
  document.getElementById('processing').classList.add('visible');
  dispatchWorkerTask('export', { forExport: true, upscale: state.exportUpscale });
}

// ═══════════════════════════════════════════════════════════════════
// RENDERING ─ SPLIT VIEW & LOUPE
// ═══════════════════════════════════════════════════════════════════

function drawSplit() {
  if (!state.sourceCanvas || !state.processedCanvas) return;
  const src = state.sourceCanvas, proc = state.processedCanvas;
  const area = document.getElementById('canvas-area');
  const scale = Math.min(area.clientWidth / src.width, area.clientHeight / src.height, 1);
  const dispW = Math.floor(src.width * scale), dispH = Math.floor(src.height * scale);

  const preview = document.getElementById('preview-canvas');
  preview.width = dispW; preview.height = dispH;
  preview.style.width = dispW + 'px'; preview.style.height = dispH + 'px';

  const ctx = preview.getContext('2d');
  ctx.clearRect(0, 0, dispW, dispH);
  const splitPx = Math.round(state.splitX * dispW);

  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, splitPx, dispH); ctx.clip();
  ctx.drawImage(src, 0, 0, dispW, dispH); ctx.restore();

  ctx.save(); ctx.beginPath(); ctx.rect(splitPx, 0, dispW - splitPx, dispH); ctx.clip();
  ctx.drawImage(proc, 0, 0, dispW, dispH); ctx.restore();

  const splitLine = document.getElementById('split-line');
  splitLine.style.display = 'block';
  splitLine.style.left   = (area.clientWidth  / 2 - dispW / 2 + splitPx) + 'px';
  splitLine.style.top    = (area.clientHeight / 2 - dispH / 2) + 'px';
  splitLine.style.height = dispH + 'px';
}

function updateLoupe(e) {
  if (!state.loupeActive || !state.loupeFullRes || !state.sourceCanvas) return;
  const preview      = document.getElementById('preview-canvas');
  const container    = document.getElementById('canvas-container');
  const loupe        = document.getElementById('loupe');
  const loupeCanvas  = document.getElementById('loupe-canvas');
  const loupeCtx     = loupeCanvas.getContext('2d');

  const previewRect   = preview.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const mx = e.clientX - previewRect.left, my = e.clientY - previewRect.top;

  if (mx < 0 || mx > previewRect.width || my < 0 || my > previewRect.height) {
    loupe.classList.remove('visible'); return;
  }

  const srcW = state.loupeFullRes.width, srcH = state.loupeFullRes.height;
  const fx = (mx / previewRect.width) * srcW, fy = (my / previewRect.height) * srcH;
  const loupeSize = 220, sampleSize = 110;
  const sx = Math.round(fx - sampleSize / 2), sy = Math.round(fy - sampleSize / 2);

  loupeCanvas.width = loupeSize; loupeCanvas.height = loupeSize;
  loupeCtx.imageSmoothingEnabled = false;
  loupeCtx.fillStyle = state.moduleParams.halftone.paperColor;
  loupeCtx.fillRect(0, 0, loupeSize, loupeSize);

  const csx = Math.max(0, sx), csy = Math.max(0, sy);
  const cdx = Math.max(0, -sx), cdy = Math.max(0, -sy);
  const csw = Math.min(sampleSize - cdx, srcW - csx), csh = Math.min(sampleSize - cdy, srcH - csy);
  if (csw > 0 && csh > 0) loupeCtx.drawImage(state.loupeFullRes, csx, csy, csw, csh, cdx * 2, cdy * 2, csw * 2, csh * 2);

  let lx = e.clientX - containerRect.left + 20, ly = e.clientY - containerRect.top - loupeSize - 10;
  if (lx + loupeSize > containerRect.width) lx = e.clientX - containerRect.left - loupeSize - 20;
  if (ly < 0) ly = e.clientY - containerRect.top + 20;
  loupe.style.left = lx + 'px'; loupe.style.top = ly + 'px';
  loupe.classList.add('visible');
}

function updateSplit(e) {
  const preview = document.getElementById('preview-canvas');
  const rect = preview.getBoundingClientRect();
  state.splitX = Math.max(0, Math.min(1, (e.clientX - rect.left) / preview.width));
  drawSplit();
}

function setupSplitDrag() {
  const area = document.getElementById('canvas-area');

  const onStart = (e) => {
    if (!state.sourceCanvas) return;
    if (state.loupeActive) {
      if (state.loupeDirty) renderLoupeCache();
      updateLoupe(e); state.draggingLoupe = true; return;
    }
    state.draggingSplit = true; updateSplit(e);
  };
  const onMove = (e) => {
    if (state.draggingLoupe) { updateLoupe(e); return; }
    if (state.draggingSplit) updateSplit(e);
  };
  const onEnd = () => {
    if (state.draggingLoupe) document.getElementById('loupe').classList.remove('visible');
    state.draggingSplit = false; state.draggingLoupe = false;
  };

  area.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  area.addEventListener('touchstart', (e) => onStart(e.touches[0]), { passive: true });
  window.addEventListener('touchmove', (e) => onMove(e.touches[0]), { passive: true });
  window.addEventListener('touchend', onEnd);
}

// ═══════════════════════════════════════════════════════════════════
// UI ─ PIPELINE STRIP
// ═══════════════════════════════════════════════════════════════════

function buildPipelineStrip() {
  const strip = document.getElementById('pipeline-strip');
  strip.innerHTML = '';

  GROUP_ORDER.forEach((groupName, gi) => {
    if (gi > 0) {
      const arrow = document.createElement('div');
      arrow.className = 'group-arrow';
      arrow.textContent = '›';
      strip.appendChild(arrow);
    }

    // section = chips first, then group label + add btn to the right
    const section = document.createElement('div');
    section.className = 'group-section';

    // ── chips ──────────────────────────────────────────────────────
    const chips = document.createElement('div');
    chips.className = 'chips-row';

    GROUP_MODULES[groupName].forEach(id => {
      if (!state.activeModules.has(id)) return;
      const def  = MODULE_DEFS[id];
      const chip = document.createElement('div');
      chip.className = 'module-chip' + (state.activePanel === id ? ' active' : '');
      chip.dataset.id = id;
      if (def.desc) chip.title = def.desc;

      if (id === 'halftone') {
        const mode = state.moduleParams.halftone.mode;
        const dots = document.createElement('div');
        dots.className = 'chip-color-dots';
        if (mode === 'cmyk') {
          [['var(--cyan-ink)'],['var(--mag-ink)'],['var(--yel-ink)'],['var(--blk-ink)']].forEach(([c]) => {
            const d = document.createElement('div'); d.className = 'chip-color-dot'; d.style.background = c; dots.appendChild(d);
          });
        } else if (mode === 'duotone') {
          ['duotoneColor1','duotoneColor2'].forEach(k => {
            const d = document.createElement('div'); d.className = 'chip-color-dot'; d.style.background = state.moduleParams.halftone[k]; dots.appendChild(d);
          });
        } else {
          const d = document.createElement('div'); d.className = 'chip-color-dot'; d.style.background = state.moduleParams.halftone.duotoneColor1 || '#000'; dots.appendChild(d);
        }
        chip.appendChild(dots);
      } else {
        const dot = document.createElement('div'); dot.className = 'chip-dot'; chip.appendChild(dot);
      }

      const chipLabel = document.createElement('div');
      chipLabel.className = 'chip-label'; chipLabel.textContent = def.label;
      chip.appendChild(chipLabel);

      if (def.removable) {
        const rm = document.createElement('div');
        rm.className = 'chip-remove'; rm.textContent = '×';
        rm.addEventListener('click', (e) => {
          e.stopPropagation(); state.activeModules.delete(id);
          if (state.activePanel === id) closePanel();
          buildPipelineStrip(); scheduleRender();
        });
        chip.appendChild(rm);
      }

      chip.addEventListener('click', () => { state.activePanel === id ? closePanel() : openPanel(id); });
      chips.appendChild(chip);
    });

    section.appendChild(chips);

    // ── group label + add btn (only for groups that have addable modules) ──
    const addable   = GROUP_MODULES[groupName].filter(id => MODULE_DEFS[id].removable);
    const notActive = addable.filter(id => !state.activeModules.has(id));
    if (addable.length > 0) {
      const head = document.createElement('div');
      head.className = 'group-head';
      const label = document.createElement('div');
      label.className = 'group-name';
      label.textContent = groupName;
      head.appendChild(label);

      const addBtn = document.createElement('button');
      addBtn.className = 'add-module-btn';
      addBtn.textContent = '+';

      if (notActive.length === 0) {
        addBtn.style.opacity = '0.3'; addBtn.disabled = true;
      } else {
        // Dropdown appended to body to escape overflow clipping on the strip
        const dropdown = document.createElement('div');
        dropdown.className = 'add-dropdown';
        document.body.appendChild(dropdown);

        notActive.forEach(id => {
          const item = document.createElement('div');
          item.className = 'add-dropdown-item';
          item.textContent = MODULE_DEFS[id].label;
          if (MODULE_DEFS[id].desc) item.title = MODULE_DEFS[id].desc;
          item.addEventListener('click', () => {
            state.activeModules.add(id);
            dropdown.classList.remove('open');
            buildPipelineStrip(); openPanel(id); scheduleRender();
          });
          dropdown.appendChild(item);
        });

        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Close any other open dropdowns
          document.querySelectorAll('.add-dropdown.open').forEach(d => d.classList.remove('open'));
          const rect = addBtn.getBoundingClientRect();
          dropdown.style.left   = rect.left + 'px';
          dropdown.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
          dropdown.style.top    = 'auto';
          dropdown.classList.toggle('open');
        });
      }

      head.appendChild(addBtn);
      section.appendChild(head);
    }

    strip.appendChild(section);
  });
}

// ═══════════════════════════════════════════════════════════════════
// UI ─ PANEL
// ═══════════════════════════════════════════════════════════════════

function openPanel(moduleId) {
  state.activePanel = moduleId;
  const def = MODULE_DEFS[moduleId];
  document.getElementById('panel-module-name').textContent = def.label;
  document.getElementById('panel-group-tag').textContent   = def.group;
  document.getElementById('panel-desc').textContent        = def.desc || '';
  const row = document.getElementById('controls-row');
  row.innerHTML = '';
  buildControls(row, moduleId);
  document.getElementById('module-panel').classList.add('open');
  buildPipelineStrip();
}

function closePanel() {
  state.activePanel = null;
  document.getElementById('module-panel').classList.remove('open');
  buildPipelineStrip();
}

// ═══════════════════════════════════════════════════════════════════
// UI ─ CONTROL BUILDERS
// Each builder receives (p, params, item) plus optional context args,
// and populates `item` with its control DOM + event wiring.
// ═══════════════════════════════════════════════════════════════════

function formatVal(v, p) {
  const unit = p.unit || '';
  if (p.step < 1) return v.toFixed(p.step < 0.05 ? 2 : 1) + unit;
  return Math.round(v) + unit;
}

function buildSliderControl(p, params, item) {
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'ctrl-slider' + (p.width ? ' ' + p.width : '');
  slider.min = p.min; slider.max = p.max; slider.step = p.step; slider.value = params[p.id];

  const val = document.createElement('div');
  val.className = 'ctrl-value' + (p.width === 'narrow' ? ' small' : '');
  val.textContent = formatVal(params[p.id], p);

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    params[p.id] = v; val.textContent = formatVal(v, p); scheduleRender();
  });
  item.appendChild(slider); item.appendChild(val);
}

function buildSelectControl(p, params, item, moduleId, container) {
  const sel = document.createElement('select');
  sel.className = 'ctrl-select';
  p.options.forEach((opt, i) => {
    const o = document.createElement('option');
    o.value = opt; o.textContent = p.labels ? p.labels[i] : opt;
    if (params[p.id] === opt) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    params[p.id] = sel.value;
    // Halftone mode change alters which params are visible — rebuild the panel
    if (moduleId === 'halftone') { container.innerHTML = ''; buildControls(container, moduleId); buildPipelineStrip(); }
    scheduleRender();
  });
  item.appendChild(sel);
}

function buildToggleControl(p, params, item) {
  const tg = document.createElement('div');
  tg.className = 'ctrl-toggle';
  p.options.forEach(opt => {
    const btn = document.createElement('div');
    btn.className = 'ctrl-toggle-btn' + (params[p.id] === opt ? ' active' : '');
    btn.textContent = opt.toUpperCase();
    btn.addEventListener('click', () => {
      params[p.id] = opt;
      tg.querySelectorAll('.ctrl-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); scheduleRender();
    });
    tg.appendChild(btn);
  });
  item.appendChild(tg);
}

function buildColorControl(p, params, item, moduleId) {
  const swatch = document.createElement('div');
  swatch.className = 'ctrl-color'; swatch.style.background = params[p.id];
  const input = document.createElement('input');
  input.type = 'color'; input.value = params[p.id];
  input.addEventListener('input', () => {
    params[p.id] = input.value; swatch.style.background = input.value;
    if (moduleId === 'halftone') {
      buildPipelineStrip();
      Object.values(_htDrawers).forEach(fn => fn());
    }
    scheduleRender();
  });
  swatch.appendChild(input); item.appendChild(swatch);
}

function buildXYPadControl(p, params, item) {
  item.className = 'ctrl-custom-wrap'; item.innerHTML = '';
  const padLabel = document.createElement('div');
  padLabel.className = 'ctrl-custom-label'; padLabel.style.color = p.color; padLabel.textContent = p.label;
  item.appendChild(padLabel);

  const pad = document.createElement('canvas');
  pad.className = 'ctrl-xypad'; pad.width = 90; pad.height = 90;
  item.appendChild(pad);

  const readout = document.createElement('div');
  readout.className = 'ctrl-xypad-readout';
  item.appendChild(readout);

  const range = p.max - p.min;

  function drawPad() {
    const cx = pad.getContext('2d');
    cx.clearRect(0, 0, 90, 90);
    cx.strokeStyle = 'rgba(255,255,255,0.05)'; cx.lineWidth = 1;
    for (let g = 0; g <= 90; g += 22.5) {
      cx.beginPath(); cx.moveTo(g, 0); cx.lineTo(g, 90); cx.stroke();
      cx.beginPath(); cx.moveTo(0, g); cx.lineTo(90, g); cx.stroke();
    }
    cx.strokeStyle = 'rgba(255,255,255,0.12)';
    cx.beginPath(); cx.moveTo(45, 0); cx.lineTo(45, 90); cx.stroke();
    cx.beginPath(); cx.moveTo(0, 45); cx.lineTo(90, 45); cx.stroke();

    const xVal = params[p.xId] || 0, yVal = params[p.yId] || 0;
    const px = ((xVal - p.min) / range) * 90, py = ((yVal - p.min) / range) * 90;
    cx.strokeStyle = p.color + '44'; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(px, 0); cx.lineTo(px, 90); cx.stroke();
    cx.beginPath(); cx.moveTo(0, py); cx.lineTo(90, py); cx.stroke();
    cx.beginPath(); cx.arc(px, py, 4, 0, Math.PI * 2);
    cx.fillStyle = p.color; cx.fill();
    cx.strokeStyle = 'rgba(0,0,0,0.5)'; cx.lineWidth = 1; cx.stroke();
    readout.textContent = xVal.toFixed(1) + ', ' + yVal.toFixed(1) + ' px';
  }

  function updateFromMouse(e) {
    const rect = pad.getBoundingClientRect();
    const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const my = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    params[p.xId] = Math.round((p.min + mx * range) / p.step) * p.step;
    params[p.yId] = Math.round((p.min + my * range) / p.step) * p.step;
    drawPad(); scheduleRender();
  }

  let dragging = false;
  pad.addEventListener('mousedown', (e) => { dragging = true; updateFromMouse(e); });
  window.addEventListener('mousemove', (e) => { if (dragging) updateFromMouse(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
  pad.addEventListener('dblclick', () => { params[p.xId] = 0; params[p.yId] = 0; drawPad(); scheduleRender(); });
  drawPad();
}

// ─── Press chip shared label helper ─────────────────────────────
function buildChipLabel(p, item) {
  item.className = 'ctrl-custom-wrap';
  item.innerHTML = '';
  const lbl = document.createElement('div');
  lbl.className = 'ctrl-custom-label';
  lbl.textContent = p.label;
  if (p.title) { lbl.title = p.title; lbl.style.cursor = 'help'; lbl.style.borderBottom = '1px dotted var(--border2)'; }
  item.appendChild(lbl);
}

function buildPressureChip(p, params, item) {
  buildChipLabel(p, item);
  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.innerHTML = `
    <div class="press-chip-row">
      <div class="press-svg-wrap" style="width:146px">
        <svg viewBox="6.9 11.6 146.2 142.5" width="146" height="142" xmlns="http://www.w3.org/2000/svg">
          <style>
            .p-body{fill:#161310;stroke:#b8b0a0;stroke-width:1.8;stroke-linejoin:round}
            .p-face{fill:#161310;stroke:#b8b0a0;stroke-width:1.8;stroke-miterlimit:4.8}
            .p-hub{fill:none;stroke:#b8b0a0;stroke-width:1.8;stroke-miterlimit:4.8}
            .p-hub2{fill:none;stroke:#b8b0a0;stroke-width:1;stroke-miterlimit:4.8}
            .p-paper{fill:#e8e0d0}
          </style>
          <path class="p-body" d="M57.2,90.8l41.4-34.7c7.1-6,17.7-5,23.7,2.1s5,17.7-2.1,23.7l-41.4,34.7-21.6-25.7Z"/>
          <circle class="p-face" cx="68" cy="103.7" r="16.8"/>
          <g class="motion-f1"><circle class="p-hub"  cx="68" cy="103.7" r="4.8"/></g>
          <g class="motion-f2"><circle class="p-hub2" cx="68" cy="103.7" r="9"/></g>
          <rect class="p-paper" x="6.9" y="73.1" width="146.2" height="24.6"/>
          <g class="pr-top-roller">
            <path class="p-body" d="M57.2,74l41.4-34.7c7.1-6,17.7-5,23.7,2.1s5,17.7-2.1,23.7l-41.4,34.7-21.6-25.7Z"/>
            <circle class="p-face" cx="68" cy="86.9" r="16.8"/>
            <g class="motion-f1"><circle class="p-hub"  cx="68" cy="86.9" r="4.8"/></g>
            <g class="motion-f2"><circle class="p-hub2" cx="68" cy="86.9" r="9"/></g>
          </g>
        </svg>
      </div>
      <div class="press-vslider-wrap">
        <input type="range" class="vert-slider" min="${p.min}" max="${p.max}" step="${p.step}" value="${params[p.id]}">
      </div>
    </div>
  `;
  item.appendChild(chip);

  const slider    = chip.querySelector('.vert-slider');
  const topRoller = chip.querySelector('.pr-top-roller');
  const update = (val) => topRoller.setAttribute('transform', `translate(0,${-(1.0 - val) * 18})`);
  update(params[p.id]);
  slider.addEventListener('input', (e) => { const val = parseFloat(e.target.value); params[p.id] = val; update(val); scheduleRender(); });
}

function buildFeedChip(p, params, item) {
  buildChipLabel(p, item);
  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.innerHTML = `
    <div class="press-svg-wrap" style="width:142px;position:relative">
      <div class="press-fstate ${params[p.id] === 'horizontal' ? 'active' : ''}" data-feed="horizontal">
        <svg viewBox="609.6 11.6 142.5 142.5" width="142" height="142" xmlns="http://www.w3.org/2000/svg">
          <style>.fd-paper{fill:#ffebc6}.fd-roll{fill:#928875}.fd-hub{fill:#ffebc6}.fd-arrow{fill:#231f20}.fd-arc{fill:none;stroke:#fff;stroke-linecap:round;stroke-miterlimit:1.7;stroke-width:1.3}</style>
          <path class="fd-paper" d="M691.4,129.6l24-24c7.4-7.4,7.4-19.5,0-27-7.4-7.4-19.5-7.4-27,0l-24,24"/>
          <circle class="fd-roll" cx="677.9" cy="116.2" r="19.1"/>
          <circle class="fd-hub"  cx="677.9" cy="116.2" r="5.4"/>
          <g class="motion-f1"><path class="fd-arc" d="M666.2,116.2c0-6.5,5.2-11.7,11.7-11.7"/><path class="fd-arc" d="M689.6,116.2c0,6.5-5.2,11.7-11.7,11.7"/></g>
          <g class="motion-f2"><path class="fd-arc" d="M669,116.2c0-4.9,3.9-8.9,8.9-8.9"/><path class="fd-arc" d="M686.8,116.2c0,4.9-3.9,8.9-8.9,8.9"/></g>
          <polygon class="fd-paper" points="679.9 97.1 608.3 97.1 608.3 73.1 703.9 73.1 679.9 97.1"/>
          <g class="press-fa">
            <polygon class="fd-arrow" points="655.8 76.9 648.4 88 643.8 88 638.3 93.5 635.7 93.5 641.2 88 635.7 88 655.8 76.9"/>
            <polygon class="fd-arrow" points="672.7 76.9 665.2 88 660.7 88 655.1 93.5 652.5 93.5 658.1 88 652.5 88 672.7 76.9"/>
            <polygon class="fd-arrow" points="689.5 76.9 682 88 677.5 88 671.9 93.5 669.3 93.5 674.9 88 669.3 88 689.5 76.9"/>
          </g>
          <g class="press-fb">
            <polygon class="fd-arrow" points="664.2 76.9 656.8 88 652.2 88 646.7 93.5 644.1 93.5 649.6 88 644.1 88 664.2 76.9"/>
            <polygon class="fd-arrow" points="681.1 76.9 673.6 88 669.1 88 663.5 93.5 660.9 93.5 666.5 88 660.9 88 681.1 76.9"/>
          </g>
        </svg>
      </div>
      <div class="press-fstate ${params[p.id] === 'vertical' ? 'active' : ''}" data-feed="vertical">
        <svg viewBox="609.6 11.6 142.5 142.5" width="142" height="142" xmlns="http://www.w3.org/2000/svg">
          <path class="fd-paper" d="M691.4,129.6l24-24c7.4-7.4,7.4-19.5,0-27-7.4-7.4-19.5-7.4-27,0l-24,24"/>
          <circle class="fd-roll" cx="677.9" cy="116.2" r="19.1"/>
          <circle class="fd-hub"  cx="677.9" cy="116.2" r="5.4"/>
          <g class="motion-f1"><path class="fd-arc" d="M666.2,116.2c0-6.5,5.2-11.7,11.7-11.7"/><path class="fd-arc" d="M689.6,116.2c0,6.5-5.2,11.7-11.7,11.7"/></g>
          <g class="motion-f2"><path class="fd-arc" d="M669,116.2c0-4.9,3.9-8.9,8.9-8.9"/><path class="fd-arc" d="M686.8,116.2c0,4.9-3.9,8.9-8.9,8.9"/></g>
          <polygon class="fd-paper" points="679.9 97.1 608.3 97.1 608.3 73.1 703.9 73.1 679.9 97.1"/>
          <g class="press-fa" transform="rotate(90,662,85.2)">
            <polygon class="fd-arrow" points="655.8 76.9 648.4 88 643.8 88 638.3 93.5 635.7 93.5 641.2 88 635.7 88 655.8 76.9"/>
            <polygon class="fd-arrow" points="672.7 76.9 665.2 88 660.7 88 655.1 93.5 652.5 93.5 658.1 88 652.5 88 672.7 76.9"/>
            <polygon class="fd-arrow" points="689.5 76.9 682 88 677.5 88 671.9 93.5 669.3 93.5 674.9 88 669.3 88 689.5 76.9"/>
          </g>
          <g class="press-fb" transform="rotate(90,662,85.2)">
            <polygon class="fd-arrow" points="664.2 76.9 656.8 88 652.2 88 646.7 93.5 644.1 93.5 649.6 88 644.1 88 664.2 76.9"/>
            <polygon class="fd-arrow" points="681.1 76.9 673.6 88 669.1 88 663.5 93.5 660.9 93.5 666.5 88 660.9 88 681.1 76.9"/>
          </g>
        </svg>
      </div>
    </div>
    <div class="press-toggle-wrap" style="width:142px">
      <button class="press-toggle-btn ${params[p.id] === 'vertical'   ? 'active' : ''}" data-val="vertical">Vert</button>
      <button class="press-toggle-btn ${params[p.id] === 'horizontal' ? 'active' : ''}" data-val="horizontal">Horiz</button>
    </div>
  `;
  item.appendChild(chip);

  chip.querySelectorAll('.press-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val; params[p.id] = val;
      chip.querySelectorAll('.press-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.val === val));
      chip.querySelectorAll('.press-fstate').forEach(s => s.classList.toggle('active', s.dataset.feed === val));
      scheduleRender();
    });
  });
}

function buildLaydownChip(p, params, item) {
  buildChipLabel(p, item);
  const chip = document.createElement('div');
  chip.className = 'press-chip';

  const LD_SEQS = [
    { val:'k-c-m-y', label:'K–C–M–Y', order:['k','c','m','y'] },
    { val:'y-m-c-k', label:'Y–M–C–K', order:['y','m','c','k'] },
    { val:'c-m-y-k', label:'C–M–Y–K', order:['c','m','y','k'] },
    { val:'m-c-y-k', label:'M–C–Y–K', order:['m','c','y','k'] },
  ];
  const LD_INK = {
    k: { cx:214, body:'M207.6,65.4l23-19.3c4.2-3.6,10.5-3,14.1,1.2s3,10.5-1.2,14.1l-23,19.3-12.9-15.3Z', fill:'#3a3530', stroke:'#888',    hub:'#ccc'     },
    c: { cx:250, body:'M243.6,65.4l23-19.3c4.2-3.6,10.5-3,14.1,1.2s3,10.5-1.2,14.1l-23,19.3-12.9-15.3Z', fill:'#00a0d8', stroke:'#006a96', hub:'#80d0ee'  },
    m: { cx:286, body:'M279.6,65.4l23-19.3c4.2-3.6,10.5-3,14.1,1.2s3,10.5-1.2,14.1l-23,19.3-12.9-15.3Z', fill:'#d8006a', stroke:'#96004a', hub:'#f080b8'  },
    y: { cx:322, body:'M315.6,65.4l23-19.3c4.2-3.6,10.5-3,14.1,1.2s3,10.5-1.2,14.1l-23,19.3-12.9-15.3Z', fill:'#d8c800', stroke:'#968c00', hub:'#ece880'  },
  };
  const LD_SLOTS = [214, 250, 286, 322];
  const LD_CY = 73.1, LD_R = 10;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const curIdx = Math.max(0, LD_SEQS.findIndex(s => s.val === params[p.id]));

  chip.innerHTML = `
    <div class="press-svg-wrap" style="width:160px">
      <svg viewBox="200 11.6 160 142.5" width="160" height="142" xmlns="http://www.w3.org/2000/svg">
        <rect x="200" y="73.1" width="160" height="24" fill="#e8e0d0"/>
        <g class="press-z1">
          <line x1="345" y1="80" x2="300" y2="80" stroke="#b0a890" stroke-width="1.2"/>
          <line x1="338" y1="85" x2="285" y2="85" stroke="#b0a890" stroke-width="1.2"/>
          <line x1="350" y1="90" x2="310" y2="90" stroke="#b0a890" stroke-width="1.2"/>
        </g>
        <g class="press-z2">
          <line x1="352" y1="80" x2="308" y2="80" stroke="#b0a890" stroke-width="1.2"/>
          <line x1="344" y1="85" x2="293" y2="85" stroke="#b0a890" stroke-width="1.2"/>
          <line x1="356" y1="90" x2="318" y2="90" stroke="#b0a890" stroke-width="1.2"/>
        </g>
        <g class="ld-rollers"></g>
      </svg>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;width:160px">
      <input type="range" class="press-hslider" style="width:160px" min="0" max="3" step="1" value="${curIdx}">
      <div class="press-seq-label"></div>
    </div>
  `;
  item.appendChild(chip);

  const ldRollers  = chip.querySelector('.ld-rollers');
  const ldLabel    = chip.querySelector('.press-seq-label');
  const ldSlider   = chip.querySelector('.press-hslider');

  function buildLdRoller(slotIdx, inkKey) {
    const d = LD_INK[inkKey], dx = LD_SLOTS[slotIdx] - d.cx;
    const g = el('g', { transform: `translate(${dx},0)` });
    g.appendChild(el('path',   { d: d.body, fill: d.fill, stroke: d.stroke, 'stroke-width':'1.5', 'stroke-linejoin':'round', 'stroke-miterlimit':'4' }));
    g.appendChild(el('circle', { cx: d.cx, cy: LD_CY, r: LD_R, fill: d.fill, stroke: d.stroke, 'stroke-width':'1.5', 'stroke-miterlimit':'4' }));
    const f1 = el('g', { class:'motion-f1' }); f1.appendChild(el('circle', { cx:d.cx, cy:LD_CY, r:'3.5', fill:'none', stroke:d.hub, 'stroke-width':'1.3', 'stroke-miterlimit':'4' }));
    const f2 = el('g', { class:'motion-f2' }); f2.appendChild(el('circle', { cx:d.cx, cy:LD_CY, r:'6',   fill:'none', stroke:d.hub, 'stroke-width':'1',   'stroke-miterlimit':'4' }));
    g.appendChild(f1); g.appendChild(f2);
    return g;
  }

  function renderLdSeq(idx) {
    const seq = LD_SEQS[idx];
    ldRollers.innerHTML = '';
    // Render back-to-front so front roller paints over back ones
    for (let i = seq.order.length - 1; i >= 0; i--) ldRollers.appendChild(buildLdRoller(i, seq.order[i]));
    ldLabel.textContent = seq.label;
    params[p.id] = seq.val;
  }

  renderLdSeq(curIdx);
  ldSlider.addEventListener('input', (e) => { renderLdSeq(parseInt(e.target.value)); scheduleRender(); });
}

function buildSlurChip(p, params, item) {
  buildChipLabel(p, item);
  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.innerHTML = `
    <div class="press-svg-wrap" style="width:160px">
      <svg viewBox="399 11.6 160 142.5" width="160" height="142" xmlns="http://www.w3.org/2000/svg">
        <path d="M492.3,63.9l29.1-24.4c5.1-4.3,12.6-3.6,16.9,1.5s3.6,12.6-1.5,16.9l-29.1,24.4-15.4-18.4Z" fill="#3a3530" stroke="#888" stroke-width="1.5" stroke-linejoin="round" stroke-miterlimit="4"/>
        <circle cx="500" cy="73.1" r="12" fill="#3a3530" stroke="#888" stroke-width="1.5" stroke-miterlimit="4"/>
        <g class="motion-f1"><circle cx="500" cy="73.1" r="4" fill="none" stroke="#ccc" stroke-width="1.5"/></g>
        <g class="motion-f2"><circle cx="500" cy="73.1" r="7" fill="none" stroke="#ccc" stroke-width="1"/></g>
        <rect x="400" y="73.1" width="160" height="24" fill="#e8e0d0"/>
        <g class="press-z1">
          <line x1="555" y1="79" x2="515" y2="79" stroke="#b0a890" stroke-width="1.2"/>
          <line x1="550" y1="85" x2="505" y2="85" stroke="#b0a890" stroke-width="1.2"/>
          <line x1="558" y1="91" x2="522" y2="91" stroke="#b0a890" stroke-width="1.2"/>
        </g>
        <g class="press-z2">
          <line x1="552" y1="79" x2="510" y2="79" stroke="#b0a890" stroke-width="1.2"/>
          <line x1="556" y1="85" x2="512" y2="85" stroke="#b0a890" stroke-width="1.2"/>
          <line x1="548" y1="91" x2="516" y2="91" stroke="#b0a890" stroke-width="1.2"/>
        </g>
        <g class="sl-dots-a press-fa"></g>
        <g class="sl-dots-b press-fb"></g>
        <circle cx="500" cy="73.1" r="12" fill="#3a3530" stroke="#888" stroke-width="1.5" stroke-miterlimit="4"/>
        <g class="motion-f1"><circle cx="500" cy="73.1" r="4" fill="none" stroke="#ccc" stroke-width="1.5"/></g>
        <g class="motion-f2"><circle cx="500" cy="73.1" r="7" fill="none" stroke="#ccc" stroke-width="1"/></g>
      </svg>
    </div>
    <input type="range" class="press-hslider" style="width:160px" min="${p.min}" max="${p.max}" step="${p.step}" value="${params[p.id]}">
  `;
  item.appendChild(chip);

  const SL_STATES = { low: {rx:7, ry:4, tw:0, to:0}, mid: {rx:11, ry:4, tw:7, to:0.45}, high: {rx:19, ry:4, tw:16, to:0.25} };
  const SL_A = [{x:422, y:85.1}, {x:456, y:85.1}];
  const SL_B = [{x:414, y:85.1}, {x:444, y:85.1}, {x:472, y:85.1}];
  const NS2 = 'http://www.w3.org/2000/svg';
  const el2 = (tag, attrs) => { const e = document.createElementNS(NS2, tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const getSt = (v) => v <= 0.16 ? SL_STATES.low : v <= 0.33 ? SL_STATES.mid : SL_STATES.high;

  function makeSlDot(cx, cy, st) {
    const g = document.createElementNS(NS2, 'g');
    if (st.tw > 0) {
      const tx = cx + st.rx;
      g.appendChild(el2('polygon', { points: `${tx},${cy - st.ry*.7} ${tx+st.tw},${cy - st.ry*.2} ${tx+st.tw},${cy + st.ry*.2} ${tx},${cy + st.ry*.7}`, fill:'#1a1612', opacity: st.to }));
    }
    g.appendChild(el2('ellipse', { cx, cy, rx: st.rx, ry: st.ry, fill: '#1a1612' }));
    return g;
  }

  function renderSlDots(val) {
    const st = getSt(val);
    const ga = chip.querySelector('.sl-dots-a'); ga.innerHTML = '';
    const gb = chip.querySelector('.sl-dots-b'); gb.innerHTML = '';
    for (const d of SL_A) ga.appendChild(makeSlDot(d.x, d.y, st));
    for (const d of SL_B) gb.appendChild(makeSlDot(d.x, d.y, st));
  }

  const slSlider = chip.querySelector('.press-hslider');
  renderSlDots(params[p.id]);
  slSlider.addEventListener('input', (e) => { const val = parseFloat(e.target.value); params[p.id] = val; renderSlDots(val); scheduleRender(); });
}

// ─── Angle chip for halftone screen angles ───────────────────────
// Registry of draw functions keyed by param id. Cleared each time
// buildControls runs so stale closures don't accumulate across panel opens.
// ─── Halftone chip helpers & unified draw registry ───────────────
// All halftone chip draw fns register here, keyed by param id.
// Cleared each buildControls() call — no stale closures across panel opens.
let _htDrawers = {};

function _drawShape(ctx, cx, cy, r, shape) {
  ctx.beginPath();
  if (shape === 'diamond') {
    ctx.moveTo(cx, cy - r * 1.3);
    ctx.lineTo(cx + r * 1.3, cy);
    ctx.lineTo(cx, cy + r * 1.3);
    ctx.lineTo(cx - r * 1.3, cy);
    ctx.closePath();
  } else if (shape === 'line') {
    ctx.rect(cx - r * 1.7, cy - r * 0.38, r * 3.4, r * 0.76);
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

function _drawDots(ctx, w, h, angleDeg, inkHex, cellPx, shape) {
  shape = shape || 'circle';
  const rad  = angleDeg * Math.PI / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const diag = Math.ceil(Math.sqrt(w * w + h * h) / 2) + cellPx * 2;
  const cx = w / 2, cy = h / 2;
  const r  = cellPx * 0.36;
  ctx.fillStyle = inkHex;
  for (let gy = -diag; gy < diag; gy += cellPx) {
    for (let gx = -diag; gx < diag; gx += cellPx) {
      const x = cx + gx * cosA - gy * sinA;
      const y = cy + gx * sinA + gy * cosA;
      if (x < -cellPx || x > w + cellPx || y < -cellPx || y > h + cellPx) continue;
      _drawShape(ctx, x, y, r, shape);
    }
  }
}

function _angleInkColor(id, params, mode) {
  if (mode === 'duotone') {
    if (id === 'angleK') return params.duotoneColor1 || '#1a1008';
    if (id === 'angleC') return params.duotoneColor2 || '#d4890a';
  }
  return { angleK: '#1a1612', angleC: '#009fce', angleM: '#d4006a', angleY: '#f5d800' }[id] || '#444';
}

// Helper: fill canvas with paper color then draw dots
function _fillPaper(ctx, w, h, params) {
  ctx.fillStyle = params.paperColor || '#f0ead8';
  ctx.fillRect(0, 0, w, h);
}

// ─── Mode chip ───────────────────────────────────────────────────
function buildModeChip(p, params, item, moduleId, container) {
  item.className = 'ctrl-custom-wrap';
  item.innerHTML = '';

  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.style.cssText = 'flex-direction:row; gap:6px; padding:10px;';
  item.appendChild(chip);

  const CW = 72, CH = 130;
  const MODES = [
    { val: 'bw',      label: 'B&W' },
    { val: 'duotone', label: 'DUO' },
    { val: 'cmyk',    label: 'CMYK' },
  ];

  const canvases = {};

  function drawMode(m, canvas) {
    const ctx = canvas.getContext('2d');
    _fillPaper(ctx, CW, CH, params);
    const shape = params.dotShape || 'circle';
    const cell  = Math.max(params.cellSize || 10, 8);
    const gco   = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'multiply';
    if (m.val === 'bw') {
      _drawDots(ctx, CW, CH, 45, '#1a1612', cell, shape);
    } else if (m.val === 'duotone') {
      _drawDots(ctx, CW, CH, 45, params.duotoneColor1 || '#1a1008', cell, shape);
      _drawDots(ctx, CW, CH, 75, params.duotoneColor2 || '#d4890a', cell, shape);
    } else {
      _drawDots(ctx, CW, CH, 45, '#1a1612', cell, shape);
      _drawDots(ctx, CW, CH, 15, '#009fce', cell, shape);
      _drawDots(ctx, CW, CH, 75, '#d4006a', cell, shape);
      _drawDots(ctx, CW, CH, 90, '#f5d800', cell, shape);
    }
    ctx.globalCompositeOperation = gco;
  }

  MODES.forEach(m => {
    const card = document.createElement('div');
    card.className = 'ht-option-card' + (params[p.id] === m.val ? ' active' : '');

    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    canvases[m.val] = canvas;
    drawMode(m, canvas);

    const lbl = document.createElement('div');
    lbl.className = 'press-seq-label';
    lbl.textContent = m.label;

    card.appendChild(canvas);
    card.appendChild(lbl);
    chip.appendChild(card);

    card.addEventListener('click', () => {
      params[p.id] = m.val;
      chip.querySelectorAll('.ht-option-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      container.innerHTML = '';
      buildControls(container, moduleId);
      buildPipelineStrip();
      scheduleRender();
    });
  });

  _htDrawers[p.id] = () => MODES.forEach(m => drawMode(m, canvases[m.val]));
}

// ─── Screen (cell size) chip ─────────────────────────────────────
function buildScreenChip(p, params, item) {
  item.className = 'ctrl-custom-wrap';
  item.innerHTML = '';

  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.style.gap = '8px';
  item.appendChild(chip);

  const CW = 120, CH = 120;
  const wrap = document.createElement('div');
  wrap.className = 'press-svg-wrap';
  wrap.style.cssText = `width:${CW}px; height:${CH}px;`;
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  wrap.appendChild(canvas);
  chip.appendChild(wrap);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'press-hslider';
  slider.style.width = CW + 'px';
  slider.min = p.min; slider.max = p.max; slider.step = p.step;
  slider.value = params[p.id];
  chip.appendChild(slider);

  const lbl = document.createElement('div');
  lbl.className = 'press-seq-label';
  chip.appendChild(lbl);

  function draw() {
    const ctx = canvas.getContext('2d');
    const cell  = params[p.id];
    const shape = params.dotShape || 'circle';
    const mode  = params.mode;
    _fillPaper(ctx, CW, CH, params);
    const gco = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'multiply';
    if (mode === 'bw') {
      _drawDots(ctx, CW, CH, 45, '#1a1612', cell, shape);
    } else if (mode === 'duotone') {
      _drawDots(ctx, CW, CH, 45, params.duotoneColor1 || '#1a1008', cell, shape);
      _drawDots(ctx, CW, CH, 75, params.duotoneColor2 || '#d4890a', cell, shape);
    } else {
      _drawDots(ctx, CW, CH, 45, '#1a1612', cell, shape);
      _drawDots(ctx, CW, CH, 15, '#009fce', cell, shape);
      _drawDots(ctx, CW, CH, 75, '#d4006a', cell, shape);
      _drawDots(ctx, CW, CH, 90, '#f5d800', cell, shape);
    }
    ctx.globalCompositeOperation = gco;
    lbl.textContent = cell + ' px';
  }

  _htDrawers[p.id] = draw;
  draw();

  slider.addEventListener('input', () => {
    params[p.id] = parseInt(slider.value);
    draw();
    scheduleRender();
  });
}

// ─── Dot shape chip ──────────────────────────────────────────────
function buildDotShapeChip(p, params, item) {
  item.className = 'ctrl-custom-wrap';
  item.innerHTML = '';

  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.style.cssText = 'flex-direction:row; gap:6px; padding:10px;';
  item.appendChild(chip);

  const CW = 72, CH = 130;
  const SHAPES = [
    { val: 'circle',  label: '●' },
    { val: 'diamond', label: '◆' },
    { val: 'line',    label: '▬' },
  ];

  const canvases = {};

  function drawShape(s, canvas) {
    const ctx = canvas.getContext('2d');
    const cell = Math.max(params.cellSize || 10, 10);
    _fillPaper(ctx, CW, CH, params);
    const gco = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'multiply';
    _drawDots(ctx, CW, CH, 45, '#1a1612', cell, s.val);
    ctx.globalCompositeOperation = gco;
  }

  SHAPES.forEach(s => {
    const card = document.createElement('div');
    card.className = 'ht-option-card' + (params[p.id] === s.val ? ' active' : '');

    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    canvases[s.val] = canvas;
    drawShape(s, canvas);

    const lbl = document.createElement('div');
    lbl.className = 'press-seq-label';
    lbl.textContent = s.label;

    card.appendChild(canvas);
    card.appendChild(lbl);
    chip.appendChild(card);

    card.addEventListener('click', () => {
      params[p.id] = s.val;
      chip.querySelectorAll('.ht-option-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      // Cascade to other previews — angle/screen chips should show new shape
      Object.entries(_htDrawers).forEach(([id, fn]) => { if (id !== p.id) fn(); });
      scheduleRender();
    });
  });

  _htDrawers[p.id] = () => SHAPES.forEach(s => drawShape(s, canvases[s.val]));
}

// ─── Paper color chip ────────────────────────────────────────────
function buildPaperChip(p, params, item) {
  item.className = 'ctrl-custom-wrap';
  item.innerHTML = '';

  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.style.gap = '8px';
  item.appendChild(chip);

  const CW = 120, CH = 120;
  const wrap = document.createElement('div');
  wrap.className = 'press-svg-wrap';
  wrap.style.cssText = `width:${CW}px; height:${CH}px; cursor:pointer;`;
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  wrap.appendChild(canvas);
  chip.appendChild(wrap);

  // Hidden color input, triggered by clicking the swatch
  const input = document.createElement('input');
  input.type = 'color';
  input.style.cssText = 'position:absolute; opacity:0; pointer-events:none; width:0; height:0;';
  chip.appendChild(input);

  const lbl = document.createElement('div');
  lbl.className = 'press-seq-label';
  lbl.textContent = 'PAPER';
  chip.appendChild(lbl);

  function draw() {
    const ctx = canvas.getContext('2d');
    const col = params[p.id];
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, CW, CH);
    // Subtle fiber texture suggestion
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#000';
    for (let y = 0; y < CH; y += 3) {
      if (Math.random() > 0.6) {
        ctx.fillRect(0, y, CW * (0.3 + Math.random() * 0.7), 1);
      }
    }
    ctx.globalAlpha = 1;
    input.value = col;
  }

  _htDrawers[p.id] = draw;
  draw();

  wrap.addEventListener('click', () => input.click());
  input.addEventListener('input', () => {
    params[p.id] = input.value;
    draw();
    // Paper color change cascades to all dot-field previews
    Object.entries(_htDrawers).forEach(([id, fn]) => { if (id !== p.id) fn(); });
    scheduleRender();
  });
}

// ─── Angle chip ──────────────────────────────────────────────────
function buildAngleChip(p, params, item) {
  item.className = 'ctrl-custom-wrap';
  item.innerHTML = '';

  const mode = params.mode;
  const CELL = 11;
  const CW = 120, CH = 110;

  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.style.gap = '8px';

  const wrap = document.createElement('div');
  wrap.className = 'press-svg-wrap';
  wrap.style.cssText = `width:${CW}px; height:${CH}px; flex-shrink:0;`;
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  wrap.appendChild(canvas);
  chip.appendChild(wrap);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'press-hslider';
  slider.style.width = CW + 'px';
  slider.min = p.min; slider.max = p.max; slider.step = p.step;
  slider.value = params[p.id];
  chip.appendChild(slider);

  const lbl = document.createElement('div');
  lbl.className = 'press-seq-label';
  lbl.textContent = p.label;
  chip.appendChild(lbl);

  item.appendChild(chip);

  function draw() {
    const ctx = canvas.getContext('2d');
    const shape  = params.dotShape || 'circle';
    const master = params.masterAngle || 0;
    _fillPaper(ctx, CW, CH, params);
    const gco = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'multiply';
    if (p.master) {
      const allIds = ['angleK','angleC','angleM','angleY'];
      const visible = mode === 'bw' ? ['angleK'] : mode === 'duotone' ? ['angleK','angleC'] : allIds;
      for (const id of visible) {
        _drawDots(ctx, CW, CH, (params[id] || 0) + master, _angleInkColor(id, params, mode), CELL, shape);
      }
    } else {
      _drawDots(ctx, CW, CH, params[p.id] + master, _angleInkColor(p.id, params, mode), CELL, shape);
    }
    ctx.globalCompositeOperation = gco;
  }

  _htDrawers[p.id] = draw;
  draw();

  slider.addEventListener('input', (e) => {
    params[p.id] = parseFloat(e.target.value);
    draw();
    if (p.master) {
      Object.entries(_htDrawers).forEach(([id, fn]) => { if (id !== 'masterAngle') fn(); });
    } else {
      if (_htDrawers['masterAngle']) _htDrawers['masterAngle']();
    }
    scheduleRender();
  });
}

// ─── Duotone color chip ──────────────────────────────────────────
function buildDuotoneColorChip(p, params, item) {
  item.className = 'ctrl-custom-wrap';
  item.innerHTML = '';

  const chip = document.createElement('div');
  chip.className = 'press-chip';
  chip.style.gap = '8px';
  item.appendChild(chip);

  const CW = 120, CH = 120;
  const wrap = document.createElement('div');
  wrap.className = 'press-svg-wrap';
  wrap.style.cssText = `width:${CW}px; height:${CH}px; cursor:pointer;`;
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  wrap.appendChild(canvas);
  chip.appendChild(wrap);

  const input = document.createElement('input');
  input.type = 'color';
  input.style.cssText = 'position:absolute; opacity:0; pointer-events:none; width:0; height:0;';
  chip.appendChild(input);

  const lbl = document.createElement('div');
  lbl.className = 'press-seq-label';
  lbl.textContent = p.label;
  chip.appendChild(lbl);

  function draw() {
    const ctx = canvas.getContext('2d');
    const cell   = Math.max(params.cellSize || 10, 8);
    const shape  = params.dotShape || 'circle';
    const angle  = (params[p.angleId] || 0) + (params.masterAngle || 0);
    const color  = params[p.id];
    _fillPaper(ctx, CW, CH, params);
    ctx.globalCompositeOperation = 'multiply';
    _drawDots(ctx, CW, CH, angle, color, cell, shape);
    ctx.globalCompositeOperation = 'source-over';
    input.value = color;
  }

  _htDrawers[p.id] = draw;
  draw();

  wrap.addEventListener('click', () => input.click());
  input.addEventListener('input', () => {
    params[p.id] = input.value;
    draw();
    // Cascade — mode chip, screen chip, angle chips all show this color
    Object.entries(_htDrawers).forEach(([id, fn]) => { if (id !== p.id) fn(); });
    buildPipelineStrip();
    scheduleRender();
  });
}


const CONTROL_BUILDERS = {
  'slider':           buildSliderControl,
  'select':           buildSelectControl,
  'toggle':           buildToggleControl,
  'color':            buildColorControl,
  'xypad':            buildXYPadControl,
  'pressure-roller':  buildPressureChip,
  'feed-chip':        buildFeedChip,
  'laydown-chip':     buildLaydownChip,
  'slur-chip':        buildSlurChip,
  'mode-chip':        buildModeChip,
  'screen-chip':      buildScreenChip,
  'dotshape-chip':    buildDotShapeChip,
  'paper-chip':       buildPaperChip,
  'duotone-color-chip': buildDuotoneColorChip,
  'angle-chip':       buildAngleChip,
};

function buildControls(container, moduleId) {
  const def    = MODULE_DEFS[moduleId];
  const params = state.moduleParams[moduleId];
  const mode   = moduleId === 'halftone' ? params.mode : null;

  // Clear stale chip draw registries
  _htDrawers = {};

  def.params.forEach(p => {
    // Halftone mode visibility filtering
    if (mode === 'bw'      && ['angleC','angleM','angleY','duotoneColor1','duotoneColor2'].includes(p.id)) return;
    if (mode === 'duotone' && ['angleM','angleY'].includes(p.id)) return;
    if (mode === 'cmyk'    && ['duotoneColor1','duotoneColor2'].includes(p.id)) return;

    const item = document.createElement('div');
    item.className = 'ctrl-item';

    // Standard label — chip builders override item.className and innerHTML themselves
    const label = document.createElement('div');
    label.className = 'ctrl-label' + (p.labelClass ? ' ' + p.labelClass : '');
    label.textContent = p.label;
    if (p.title) { label.title = p.title; label.style.cursor = 'help'; label.style.borderBottom = '1px dotted var(--border2)'; }
    item.appendChild(label);

    const builder = CONTROL_BUILDERS[p.type];
    if (builder) builder(p, params, item, moduleId, container);

    container.appendChild(item);
  });
}

// ═══════════════════════════════════════════════════════════════════
// IMAGE I/O & PRESETS
// ═══════════════════════════════════════════════════════════════════

function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.sourceImage  = img;
    state.sourceCanvas = imageToCanvas(img);
    document.getElementById('drop-zone').style.display        = 'none';
    document.getElementById('canvas-container').style.display = 'block';
    document.getElementById('preview-canvas').style.display   = 'block';
    triggerRender();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}


function toggleExportDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('export-dropdown');
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) updateExportSize();
}

function updateExportSize() {
  const label = document.getElementById('export-size-label');
  if (!state.sourceCanvas) { label.textContent = '—'; return; }
  label.textContent = (state.sourceCanvas.width * state.exportUpscale) + '×' + (state.sourceCanvas.height * state.exportUpscale);
}

// ═══════════════════════════════════════════════════════════════════
// HEADER CONTROLS
// ═══════════════════════════════════════════════════════════════════

function toggleHQ() {
  state.hqPreview = !state.hqPreview;
  if (state.hqPreview) state.prev2x = false;
  document.getElementById('btn-hq').classList.toggle('active', state.hqPreview);
  document.getElementById('btn-prev2x').classList.toggle('active', state.prev2x);
  triggerRender();
}

function togglePrev2x() {
  state.prev2x = !state.prev2x;
  if (state.prev2x) state.hqPreview = false;
  document.getElementById('btn-prev2x').classList.toggle('active', state.prev2x);
  document.getElementById('btn-hq').classList.toggle('active', state.hqPreview);
  triggerRender();
}

function toggleLoupe() {
  state.loupeActive = !state.loupeActive;
  const btn  = document.getElementById('btn-loupe');
  const loupe = document.getElementById('loupe');
  const area  = document.getElementById('canvas-area');
  if (state.loupeActive) {
    btn.classList.add('active'); area.classList.add('loupe-mode');
    if (state.loupeDirty && state.sourceCanvas) renderLoupeCache();
  } else {
    btn.classList.remove('active'); area.classList.remove('loupe-mode'); loupe.classList.remove('visible');
  }
}

// ═══════════════════════════════════════════════════════════════════
// PRESET MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

const BUILTIN_PRESET_NAMES = Object.keys(PRESETS);

// Load custom presets from localStorage
let customPresets = {};
try {
  const saved = localStorage.getItem('halftone_custom_presets');
  if (saved) customPresets = JSON.parse(saved);
} catch(e) {}

function persistCustomPresets() {
  try { localStorage.setItem('halftone_custom_presets', JSON.stringify(customPresets)); } catch(e) {}
}

function buildPresetDropdown() {
  const builtinEl  = document.getElementById('pd-builtin');
  const customEl   = document.getElementById('pd-custom');
  const customHead = document.getElementById('pd-custom-heading');
  if (!builtinEl) return;

  builtinEl.innerHTML = '';
  customEl.innerHTML  = '';

  // Built-in presets — no delete button
  BUILTIN_PRESET_NAMES.forEach(name => {
    const item = _makePresetItem(name, false);
    builtinEl.appendChild(item);
  });

  // Custom presets
  const customNames = Object.keys(customPresets);
  customHead.style.display = customNames.length ? '' : 'none';
  customNames.forEach(name => {
    const item = _makePresetItem(name, true);
    customEl.appendChild(item);
  });
}

function _makePresetItem(name, deletable) {
  const item = document.createElement('div');
  item.className = 'pd-item';

  const label = document.createElement('div');
  label.className = 'pd-item-name';
  label.textContent = name;
  label.addEventListener('click', () => {
    closePresetDropdown();
    applyPreset(name);
  });
  item.appendChild(label);

  if (deletable) {
    const del = document.createElement('div');
    del.className = 'pd-item-delete';
    del.textContent = '×';
    del.title = 'Delete preset';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCustomPreset(name);
    });
    item.appendChild(del);
  }

  return item;
}

function togglePresetDropdown(e) {
  e.stopPropagation();
  document.getElementById('preset-dropdown').classList.toggle('open');
}

function closePresetDropdown() {
  document.getElementById('preset-dropdown').classList.remove('open');
}

function deleteCustomPreset(name) {
  delete customPresets[name];
  persistCustomPresets();
  buildPresetDropdown();
}

function startSavePreset() {
  document.getElementById('btn-save-preset').style.display = 'none';
  const wrap = document.getElementById('preset-name-wrap');
  wrap.style.display = 'flex';
  const input = document.getElementById('preset-name-input');
  input.value = '';
  input.focus();
  input.addEventListener('keydown', _presetNameKeydown);
}

function _presetNameKeydown(e) {
  if (e.key === 'Enter') confirmSavePreset();
  if (e.key === 'Escape') cancelSavePreset();
}

function confirmSavePreset() {
  const input = document.getElementById('preset-name-input');
  const name  = input.value.trim().toUpperCase();
  if (!name) { input.focus(); return; }

  // Capture current state as a preset
  const snapshot = {
    active: Array.from(state.activeModules),
    params: JSON.parse(JSON.stringify(state.moduleParams)),
  };
  customPresets[name] = snapshot;
  persistCustomPresets();
  buildPresetDropdown();
  cancelSavePreset();

  // Flash confirmation in render-status
  const status = document.getElementById('render-status');
  const prev = status.textContent;
  status.textContent = `SAVED: ${name}`;
  setTimeout(() => { status.textContent = prev; }, 2000);
}

function cancelSavePreset() {
  const input = document.getElementById('preset-name-input');
  input.removeEventListener('keydown', _presetNameKeydown);
  document.getElementById('preset-name-wrap').style.display = 'none';
  document.getElementById('btn-save-preset').style.display  = '';
}

// applyPreset now checks both PRESETS and customPresets
function applyPreset(name) {
  const preset = PRESETS[name] || customPresets[name];
  if (!preset) return;
  state.activeModules = new Set(preset.active);
  state.activeModules.add('halftone'); state.activeModules.add('press');

  for (const [id, def] of Object.entries(MODULE_DEFS)) {
    state.moduleParams[id] = {};
    for (const p of def.params) if (p.default !== undefined) state.moduleParams[id][p.id] = p.default;
    if (def.extraDefaults) Object.assign(state.moduleParams[id], def.extraDefaults);
  }
  for (const [modId, modParams] of Object.entries(preset.params)) {
    if (state.moduleParams[modId]) Object.assign(state.moduleParams[modId], modParams);
  }

  state.activePanel = null;
  document.getElementById('module-panel').classList.remove('open');
  buildPipelineStrip();
  triggerRender();
}



document.addEventListener('DOMContentLoaded', () => {
  buildPipelineStrip();
  setupSplitDrag();

  const fileInput = document.getElementById('file-input');
  const dropZone  = document.getElementById('drop-zone');
  const area      = document.getElementById('canvas-area');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadImage(fileInput.files[0]); });

  area.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  area.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
  area.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });

  buildPresetDropdown();

  // Close any open dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.add-module-btn') && !e.target.closest('.add-dropdown')) {
      document.querySelectorAll('.add-dropdown.open').forEach(d => d.classList.remove('open'));
    }
    if (!e.target.closest('.export-wrap')) document.getElementById('export-dropdown').classList.remove('open');
    if (!e.target.closest('.preset-wrap')) closePresetDropdown();
  });

  window.addEventListener('resize', () => { if (state.processedCanvas) drawSplit(); });

  document.addEventListener('paste', (e) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (item) loadImage(item.getAsFile());
  });
});
