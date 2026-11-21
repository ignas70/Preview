'use strict';
const FONT_URL = 'lib/DejaVuSans.ttf';
const libs = {};
function loadLib(src) {
  return libs[src] || (libs[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { delete libs[src]; rej(new Error('Could not load ' + src)); };
    document.head.append(s);
  }));
}
let pdfWorker = null;
async function ensurePdfJs() {
  await loadLib('lib/pdf.min.js');
  if (!pdfWorker) { pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'; pdfWorker = new pdfjsLib.PDFWorker({ name: 'preview' }); }
}
// @cantoo/pdf-lib: a maintained pdf-lib fork that can also open protected (encrypted) PDFs
async function ensurePdfLib() { await loadLib('lib/pdf-lib-cantoo.min.js'); await loadLib('lib/fontkit-cantoo.umd.min.js'); }
const NS = 'http://www.w3.org/2000/svg';
const $ = s => document.querySelector(s);
const viewer = $('#viewer'), wrap = $('#pagesWrap'), thumbsEl = $('#thumbs');
const colorInp = $('#color'), sizeInp = $('#fontSize'), ghost = $('#ghost');

const S = {
  docs: new Map(),     // docId -> {name, bytes, pdf}
  pages: [],           // {key, docId, idx, extra, annots[]}  (+ el, thumb – runtime only)
  zoom: 1, tool: 'select', color: '#111111', fontSize: 14,
  sel: new Set(), lastSel: null, annSel: null, pending: null, cur: 0,
  fileName: 'document',
};
const images = new Map();   // imgId -> {dataUrl, w, h}
const pageInfo = new Map(); // "docId:idx" -> pdf.js page
const undoStack = [];
let uid = 1, dirty = false;
const nid = () => uid++;
// timing marks, recorded by the host only when PREVIEW_TRACE=1
function mark(what) { try { if (window.chrome && chrome.webview) chrome.webview.postMessage({ cmd: 'trace', what: what + ' @' + Math.round(performance.now()) + 'ms' }); } catch { } }

/* ---------- helpers ---------- */
let toastT;
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function busy(msg) { const b = $('#busy'); if (msg) { b.innerHTML = '<span></span>'; b.firstChild.textContent = msg; b.classList.add('show'); } else b.classList.remove('show'); }
const pdfPage = p => pageInfo.get(p.docId + ':' + p.idx);
const rotOf = p => (pdfPage(p).rotate + p.extra) % 360;
const vp = (p, scale) => pdfPage(p).getViewport({ scale, rotation: rotOf(p) });
const byKey = k => S.pages.find(p => p.key === +k);
function rotv(u, v, deg) { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [u * c - v * s, u * s + v * c]; }
function hexRgb(h) { return PDFLib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function readAsDataUrl(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); }
function dataUrlBytes(d) { const b = atob(d.split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function cap(el, e) { try { el.setPointerCapture(e.pointerId); } catch { } }
function toPage(e, p) { const r = p.el.getBoundingClientRect(); return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom }; }

/* ---------- font (Unicode, supports Lithuanian letters) ---------- */
let fontBytes = null, baseRatio = 0.93, fontPromise = null;
const ensureFont = () => fontPromise || (fontPromise = (async () => {
  const buf = await (await fetch(FONT_URL)).arrayBuffer();
  fontBytes = new Uint8Array(buf);
  const ff = new FontFace('PdfSans', buf.slice(0));
  await ff.load(); document.fonts.add(ff);
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;font-family:PdfSans;font-size:100px;line-height:1.2;white-space:pre';
  d.innerHTML = 'Xg<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
  document.body.appendChild(d);
  baseRatio = (d.lastChild.getBoundingClientRect().top - d.getBoundingClientRect().top) / 100;
  d.remove();
  S.pages.forEach(renderAnnots);
})().catch(e => { console.error(e); fontPromise = null; toast('Could not load the font'); }));

/* ---------- loading ---------- */
async function loadFiles(files, append) {
  files = [...files];
  const imgs = files.filter(f => (f.type || '').startsWith('image/'));
  const pdfs = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) { if (imgs.length && S.pages.length) useImageFile(imgs[0]).then(d => useImage(d, 'image')); else if (files.length) toast('This is not a PDF file'); return; }
  if (!append) {
    if (dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
    S.docs.forEach(d => d.pdf.destroy()); S.docs.clear(); pageInfo.clear(); S.pages = []; S.sel.clear();
    undoStack.length = 0; S.annSel = null; dirty = false; setEditing(false);
    S.form.clear(); S.formChanged.clear(); S.ocr.clear(); if (!$('#findBar').hidden) closeFind();
  } else if (S.pages.length) pushUndo();
  busy('Opening…');
  if (!append) firstPaint = newFirstPaint();
  await ensurePdfJs();
  try {
    for (const f of pdfs) {
      let pdf, bytes = null;
      mark('pdf.js ready');
      try {
        let src;
        if (f.rangePath) src = { range: await rangeTransport(f.rangePath, f.size), length: f.size, disableAutoFetch: true, disableStream: true, rangeChunkSize: 1 << 19 };
        else { bytes = new Uint8Array(await f.arrayBuffer()); src = { data: bytes.slice() }; }
        const task = pdfjsLib.getDocument({ ...src, worker: pdfWorker });
        task.onPassword = (update, reason) => askPassword(f.name, reason === 2).then(pw => {
          if (pw == null) task.destroy(); else { f.__pw = pw; busy('Opening…'); update(pw); }
        });
        pdf = await task.promise; mark('document parsed');
      }
      catch (e) { if (!/destroyed/i.test(e && e.message || '')) toast(`Could not open "${f.name}"`, 4000); continue; }
      const docId = nid();
      S.docs.set(docId, { name: f.name, bytes, path: f.rangePath || null, pdf, password: f.__pw || '' });
      // Only page 1 is read now; the others get a stand-in with page 1's size and are loaded
      // in the background (or on demand when they scroll into view).
      const first = await pdf.getPage(1); mark('page 1 loaded');
      for (let i = 0; i < pdf.numPages; i++) {
        pageInfo.set(docId + ':' + i, i === 0 ? first : { _ph: true, rotate: first.rotate, getViewport: o => first.getViewport(o) });
        S.pages.push({ key: nid(), docId, idx: i, extra: 0, annots: [] });
      }
      if (!append && S.docs.size === 1) S.fileName = f.name.replace(/\.pdf$/i, '');
    }
  } finally { busy(false); }
  const first = !append;
  if (first && !S.pages.length) { setMode('home'); return; }
  setMode('pdf'); $('#pdfName').textContent = S.fileName + '.pdf';
  rebuild(!first);
  if (first && S.pages.length) { fitWidth(1.5); viewer.scrollTop = 0; resumePosition(); loadOutline(); checkPdfSignatures(); }
  firstPaint.then(() => setTimeout(allPagesReady, 50));
  if (first) firstPaint.then(() => setTimeout(() => suggestOcr().catch(() => { }), 400));
  if (append && pdfs.length) toast(`Added ${pdfs.map(f => f.name).join(', ')}`);
}

/* ---------- lazy page loading ---------- */
function newFirstPaint() { let r; const p = new Promise(res => r = res); p.resolve = r; return p; }
let firstPaint = newFirstPaint();
function realPage(p) {
  const k = p.docId + ':' + p.idx, pg = pageInfo.get(k);
  if (!pg) return Promise.reject(new Error('gone'));
  if (!pg._ph) return Promise.resolve(pg);
  const d = S.docs.get(p.docId);
  if (!d) return Promise.reject(new Error('gone'));
  return pg._promise || (pg._promise = d.pdf.getPage(p.idx + 1).then(real => {
    if (pageInfo.get(k) !== pg) return real;
    const before = pg.getViewport({ scale: 1 });
    pageInfo.set(k, real);
    const after = real.getViewport({ scale: 1 });
    if (real.rotate !== pg.rotate || Math.abs(before.width - after.width) > 0.5 || Math.abs(before.height - after.height) > 0.5)
      for (const q of S.pages) if (q.docId === p.docId && q.idx === p.idx && q.el) {
        sizePage(q); const v = vp(q, 1);
        q.thumb.querySelector('canvas').style.aspectRatio = v.width + '/' + v.height;
        q.rendered = null; if (visible.has(q.key)) renderPage(q);
      }
    return real;
  }));
}
function allPagesReady() { return Promise.all(S.pages.map(p => realPage(p).catch(() => null))); }

/* ---------- building the view ---------- */
let io, thumbIO;
const visible = new Set();
function rebuild(keepScroll) {
  const st = viewer.scrollTop, tst = thumbsEl.scrollTop;
  io?.disconnect(); thumbIO?.disconnect(); visible.clear();
  wrap.textContent = ''; thumbsEl.textContent = '';
  io = new IntersectionObserver(onPageVis, { root: viewer, rootMargin: '800px 0px' });
  thumbIO = new IntersectionObserver(onThumbVis, { root: thumbsEl, rootMargin: '400px 0px' });
  S.pages.forEach((p, i) => {
    p.task?.cancel(); p.task = null; p.rendered = p.rendering = null; p.extrasFor = null;
    const d = document.createElement('div'); d.className = 'page'; d.dataset.key = p.key;
    const layer = document.createElement('div'); layer.className = 'layer';
    d.append(document.createElement('canvas'), layer); wrap.append(d); p.el = d;
    layer.addEventListener('pointerdown', e => onLayerDown(e, p));
    layer.addEventListener('pointermove', e => { if (S.tool === 'edittext') editHover(e, p); });
    sizePage(p); renderAnnots(p); io.observe(d);

    const t = document.createElement('div'); t.className = 'thumb'; t.draggable = true; t.dataset.key = p.key;
    const tc = document.createElement('canvas'); const v1 = vp(p, 1); tc.style.aspectRatio = v1.width + '/' + v1.height;
    const num = document.createElement('div'); num.className = 'num'; num.textContent = i + 1;
    const acts = document.createElement('div'); acts.className = 'tacts';
    acts.append(mkBtn('\uE7AD', 'Rotate', () => rotatePages([p.key], 90)), mkBtn('\uE74D', 'Delete', () => deletePages([p.key])));
    t.append(tc, num, acts); thumbsEl.append(t); p.thumb = t;
    t.addEventListener('click', e => thumbClick(e, p));
    setupThumbDrag(t, p);
    thumbIO.observe(t);
  });
  $('#empty').hidden = S.pages.length > 0;
  if (keepScroll) { viewer.scrollTop = st; thumbsEl.scrollTop = tst; }
  updateThumbSel(); updateCurrent(); updateUI();
}
function mkBtn(txt, title, fn) { const b = document.createElement('button'); b.className = 'g'; b.textContent = txt; b.title = title; b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; }
function sizePage(p) { const v = vp(p, 1); p.el.style.width = Math.round(v.width * S.zoom) + 'px'; p.el.style.height = Math.round(v.height * S.zoom) + 'px'; }

function onPageVis(entries) {
  for (const e of entries) {
    const p = byKey(e.target.dataset.key); if (!p || p.el !== e.target) continue;
    if (e.isIntersecting) { visible.add(p.key); renderPage(p); }
    else { // free memory of far-away pages
      visible.delete(p.key); p.task?.cancel(); p.task = null; p.rendered = p.rendering = null;
      const c = p.el.querySelector('canvas'); c.width = c.height = 0;
    }
  }
}
/* Night reading: invert everything except raster pictures. Picture positions come from the
   page's operator list (current transform at each image-paint operation). */
const NIGHT_FILTER = 'invert(1) hue-rotate(180deg) contrast(0.86)';
async function imageRects(p) {
  const pg = await realPage(p);
  if (pg._imgRects) return pg._imgRects;
  const O = pdfjsLib.OPS, ops = await pg.getOperatorList();
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const imgOps = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintJpegXObject].filter(x => x !== undefined));
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [], rects = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || ctm;
    else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0] && a[0].length === 6) ctm = mul(ctm, a[0]); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (imgOps.has(fn)) rects.push([[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]));
  }
  pg._imgRects = rects;
  return rects;
}
async function nightify(p, c, v) {
  const rects = await imageRects(p);
  const src = document.createElement('canvas'); src.width = c.width; src.height = c.height;
  src.getContext('2d').drawImage(c, 0, 0);
  const ctx = c.getContext('2d');
  ctx.save(); ctx.filter = NIGHT_FILTER; ctx.drawImage(src, 0, 0); ctx.restore();
  const area = c.width * c.height;
  for (const pts of rects) {
    const q = pts.map(([x, y]) => v.convertToViewportPoint(x, y));
    const x0 = Math.max(0, Math.ceil(Math.min(...q.map(t => t[0])))), x1 = Math.min(c.width, Math.floor(Math.max(...q.map(t => t[0]))));
    const y0 = Math.max(0, Math.ceil(Math.min(...q.map(t => t[1])))), y1 = Math.min(c.height, Math.floor(Math.max(...q.map(t => t[1]))));
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2 || w * h > area * 0.85) continue; // full-page images are scans: keep them inverted
    ctx.drawImage(src, x0, y0, w, h, x0, y0, w, h);
  }
}
async function renderPage(p) {
  if (pdfPage(p)._ph) { try { await realPage(p); } catch { return; } if (!visible.has(p.key)) return; }
  const want = S.zoom + '|' + rotOf(p) + '|' + Night.on;
  if (p.rendered === want || p.rendering === want) return;
  p.task?.cancel(); p.rendering = want;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const v = vp(p, S.zoom * dpr);
  const c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
  // An opaque canvas gets ClearType (coloured sub-pixel) text smoothing – crisp by day, but inverted for
  // night reading those red/blue edges turn into a magenta/green glow. Night mode uses greyscale smoothing.
  const task = pdfPage(p).render({ canvasContext: c.getContext('2d', { alpha: !!Night.on }), viewport: v, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS });
  p.task = task;
  try { await task.promise; if (Night.on) await nightify(p, c, v); } catch (e) { return; }
  if (p.rendering !== want) return;
  p.task = null; p.rendering = null; p.rendered = want;
  p.el.querySelector('canvas').replaceWith(c);
  if (!firstPaint.done) { firstPaint.done = true; mark('first page painted'); }
  firstPaint.resolve();
  pageExtras(p);
}
function onThumbVis(entries) {
  for (const e of entries) if (e.isIntersecting) {
    const p = byKey(e.target.dataset.key); if (!p) continue;
    thumbIO.unobserve(e.target);
    const c = e.target.querySelector('canvas');
    // thumbnails wait until the first page is on screen so they never slow it down
    firstPaint.then(() => realPage(p)).then(pg => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const v = vp(p, (118 * dpr) / vp(p, 1).width);
      c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      return pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise.then(() => Night.on ? nightify(p, c, v) : null);
    }).catch(() => { });
  }
}

/* ---------- annotations rendering ---------- */
function renderAnnots(p) {
  if (!p.el) return;
  const layer = p.el.querySelector('.layer'); layer.textContent = '';
  const z = S.zoom, v = vp(p, 1);
  for (const a of p.annots) {
    const isSel = S.annSel && S.annSel.a === a;
    if (a.type === 'ink') {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'ink' + (isSel ? ' sel' : ''));
      svg.setAttribute('viewBox', `0 0 ${v.width} ${v.height}`); svg.setAttribute('preserveAspectRatio', 'none');
      svg.dataset.id = a.id;
      const pts = a.points.map(q => q[0].toFixed(2) + ',' + q[1].toFixed(2)).join(' ');
      const mk = (cls, color, w) => { const l = document.createElementNS(NS, 'polyline'); l.setAttribute('class', cls); l.setAttribute('points', pts); l.setAttribute('fill', 'none'); l.setAttribute('stroke', color); l.setAttribute('stroke-width', w); l.setAttribute('stroke-linecap', 'round'); l.setAttribute('stroke-linejoin', 'round'); return l; };
      const hit = mk('hit', 'transparent', a.width + 8);
      svg.append(mk('line', a.color, a.width), hit);
      hit.addEventListener('pointerdown', e => annotDown(e, p, a, svg));
      layer.append(svg); continue;
    }
    if (a.type === 'note') { layer.append(noteEl(p, a, isSel)); continue; }
    if (a.type === 'edit') { layer.append(editEl(p, a, isSel)); continue; }
    const el = document.createElement('div');
    el.className = 'annot ' + a.type + (a.kind ? ' ' + a.kind : '') + (isSel ? ' sel' : '');
    el.dataset.id = a.id; el.style.left = a.x * z + 'px'; el.style.top = a.y * z + 'px';
    if (a.rot) el.style.transform = `rotate(${a.rot}deg)`;
    const c = document.createElement('div'); c.className = 'content'; el.append(c);
    if (a.type === 'text') { c.textContent = a.text; c.style.fontSize = a.size * z + 'px'; c.style.color = a.color; }
    else {
      el.style.width = a.w * z + 'px'; el.style.height = a.h * z + 'px';
      if (a.type === 'image') { const im = new Image(); im.src = images.get(a.imgId).dataUrl; im.draggable = false; c.append(im); }
      else { c.style.background = a.color; c.style.opacity = a.opacity; if (a.kind === 'highlight') c.style.mixBlendMode = 'multiply'; }
      const h = document.createElement('div'); h.className = 'handle'; el.append(h);
      h.addEventListener('pointerdown', e => resizeDown(e, p, a, el));
    }
    const del = document.createElement('button'); del.className = 'del g'; del.textContent = '\uE711'; del.title = 'Delete';
    del.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); removeAnnot(p, a); });
    el.append(del);
    el.addEventListener('pointerdown', e => annotDown(e, p, a, el));
    layer.append(el);
  }
}
function selectAnnot(p, a) {
  document.querySelectorAll('.annot.sel, svg.ink.sel').forEach(x => x.classList.remove('sel'));
  S.annSel = a ? { p, a } : null;
  if (a) {
    p.el.querySelector(`[data-id="${a.id}"]`)?.classList.add('sel');
    if (a.color) colorInp.value = a.color;
    if (a.size) sizeInp.value = a.size;
  } else { colorInp.value = S.color; sizeInp.value = S.fontSize; }
}
function removeAnnot(p, a) {
  pushUndo(); const i = p.annots.indexOf(a); if (i >= 0) p.annots.splice(i, 1);
  S.annSel = null; renderAnnots(p);
}

/* ---------- pointer interactions ---------- */
let lastDown = { id: null, t: 0 };
function annotDown(e, p, a, el) {
  if (e.button !== 0) return;
  const content = el.querySelector?.('.content');
  const texty = a.type === 'text' || a.type === 'edit';
  if (texty && content?.isContentEditable) { e.stopPropagation(); return; }
  e.stopPropagation(); e.preventDefault();
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  const now = Date.now(), dbl = lastDown.id === a.id && now - lastDown.t < 400; lastDown = { id: a.id, t: now };
  if (texty && (dbl || S.tool === 'text' || S.tool === 'edittext')) { startEdit(p, a); return; }
  selectAnnot(p, a);
  if (a.type === 'edit') return;   // retyped text stays where the original was
  const z = S.zoom, sx = e.clientX, sy = e.clientY, ox = a.x, oy = a.y;
  const opts = a.points?.map(q => q.slice()); let moved = false, d = [0, 0];
  const tgt = e.currentTarget; cap(tgt, e);
  const mv = ev => {
    const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
    if (!moved) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; pushUndo(); moved = true; }
    if (a.type === 'ink') { d = [dx, dy]; el.style.transform = `translate(${dx * z}px,${dy * z}px)`; }
    else { a.x = ox + dx; a.y = oy + dy; el.style.left = a.x * z + 'px'; el.style.top = a.y * z + 'px'; }
  };
  const up = () => {
    tgt.removeEventListener('pointermove', mv); tgt.removeEventListener('pointerup', up); tgt.removeEventListener('pointercancel', up);
    if (a.type === 'ink' && moved) { a.points = opts.map(([x, y]) => [x + d[0], y + d[1]]); renderAnnots(p); }
  };
  tgt.addEventListener('pointermove', mv); tgt.addEventListener('pointerup', up); tgt.addEventListener('pointercancel', up);
}
function resizeDown(e, p, a, el) {
  e.stopPropagation(); e.preventDefault(); pushUndo();
  const z = S.zoom, sx = e.clientX, sy = e.clientY, ow = a.w, oh = a.h, h = e.currentTarget;
  cap(h, e);
  const mv = ev => {
    const [u, v] = rotv((ev.clientX - sx) / z, (ev.clientY - sy) / z, -(a.rot || 0));
    if (a.type === 'image' && !ev.shiftKey) { a.w = Math.max(8, ow + u); a.h = a.w * oh / ow; }
    else { a.w = Math.max(4, ow + u); a.h = Math.max(4, oh + v); }
    el.style.width = a.w * z + 'px'; el.style.height = a.h * z + 'px';
  };
  const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); };
  h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
}
function onLayerDown(e, p) {
  if (e.button !== 0 || e.target !== e.currentTarget) return;
  const pt = toPage(e, p);
  const editing = document.activeElement?.isContentEditable;
  if (editing) { document.activeElement.blur(); if (S.tool === 'text') return; }
  switch (S.tool) {
    case 'select': selectAnnot(null); break;
    case 'text': {
      e.preventDefault(); pushUndo();
      const a = { id: nid(), type: 'text', x: pt.x, y: pt.y - S.fontSize * 0.6, text: '', size: S.fontSize, color: S.color, rot: 0 };
      p.annots.push(a); renderAnnots(p); startEdit(p, a, true); break;
    }
    case 'sign': case 'image':
      if (!S.pending) { setTool(S.tool); break; }
      placePending(p, pt); break;
    case 'whiteout': case 'highlight': drawRect(e, p, pt); break;
    case 'pen': drawInk(e, p, pt); break;
    case 'note': e.preventDefault(); addNote(p, pt); break;
    case 'stamp': e.preventDefault(); placeStamp(p, pt); break;
    case 'edittext': e.preventDefault(); editTextAt(e, p); break;
  }
}
function startEdit(p, a, skipUndo, selectAll) {
  const el = p.el.querySelector(`.annot[data-id="${a.id}"]`); if (!el) return;
  const c = el.querySelector('.content');
  if (!skipUndo) pushUndo();
  selectAnnot(p, a);
  c.contentEditable = 'plaintext-only'; if (c.contentEditable !== 'plaintext-only') c.contentEditable = 'true';
  c.focus();
  const r = document.createRange(); r.selectNodeContents(c); if (!selectAll) r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  c.oninput = () => { a.text = c.innerText; };
  c.onkeydown = ev => { if (ev.key === 'Escape') c.blur(); ev.stopPropagation(); };
  c.onblur = () => {
    c.contentEditable = 'false'; a.text = c.innerText.replace(/\n$/, '');
    if (a.type === 'edit' ? a.text === a.orig : !a.text.trim()) { const i = p.annots.indexOf(a); if (i >= 0) p.annots.splice(i, 1); if (S.annSel?.a === a) S.annSel = null; }
    renderAnnots(p);
  };
}
function drawRect(e, p, pt) {
  e.preventDefault(); pushUndo();
  const kind = S.tool, wo = kind === 'whiteout';
  const a = { id: nid(), type: 'rect', kind, x: pt.x, y: pt.y, w: 0, h: 0, color: wo ? '#ffffff' : '#ffd400', opacity: wo ? 1 : 0.45 };
  p.annots.push(a);
  const layer = e.currentTarget; cap(layer, e);
  const mv = ev => { const q = toPage(ev, p); a.x = Math.min(pt.x, q.x); a.y = Math.min(pt.y, q.y); a.w = Math.abs(q.x - pt.x); a.h = Math.abs(q.y - pt.y); renderAnnots(p); };
  const up = () => {
    layer.removeEventListener('pointermove', mv); layer.removeEventListener('pointerup', up);
    if (a.w < 3 || a.h < 3) { p.annots.pop(); undoStack.pop(); }
    else S.annSel = { p, a };
    renderAnnots(p);
  };
  layer.addEventListener('pointermove', mv); layer.addEventListener('pointerup', up);
}
function drawInk(e, p, pt) {
  e.preventDefault(); pushUndo();
  const a = { id: nid(), type: 'ink', points: [[pt.x, pt.y]], color: S.color, width: 2 };
  p.annots.push(a);
  const layer = e.currentTarget; cap(layer, e);
  const mv = ev => { const q = toPage(ev, p); const l = a.points[a.points.length - 1]; if (Math.hypot(q.x - l[0], q.y - l[1]) * S.zoom < 1.5) return; a.points.push([q.x, q.y]); renderAnnots(p); };
  const up = () => { layer.removeEventListener('pointermove', mv); layer.removeEventListener('pointerup', up); if (a.points.length === 1) a.points.push([pt.x + 0.01, pt.y]); renderAnnots(p); };
  layer.addEventListener('pointermove', mv); layer.addEventListener('pointerup', up);
}
function placePending(p, pt) {
  const { imgId, w, h, kind } = S.pending;
  pushUndo();
  const a = { id: nid(), type: 'image', imgId, x: pt.x - w / 2, y: pt.y - h / 2, w, h, rot: 0 };
  p.annots.push(a); S.pending = null; ghost.style.display = 'none';
  setTool('select'); S.annSel = { p, a }; renderAnnots(p);
  toast('Drag to move · drag the corner to resize');
}

/* ---------- tools ---------- */
function setTool(t, keepPending) {
  if (!S.pages.length && t !== 'select') { toast('Open a PDF first'); return; }
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  if (t === 'sign' && !keepPending) { openSign(); return; }
  if (t === 'image' && !keepPending) { $('#fileImg').click(); return; }
  if (t === 'stamp' && !keepPending) { openStampMenu(); return; }
  if (!keepPending) S.stampText = null;
  if (t !== 'edittext') hoverBox.remove();
  if (!keepPending) { S.pending = null; ghost.style.display = 'none'; }
  S.tool = t; document.body.dataset.tool = t;
  document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  if (t !== 'select') selectAnnot(null);
}
async function useImage(dataUrl, kind) {
  const im = await loadImg(dataUrl);
  const id = nid(); images.set(id, { dataUrl, w: im.naturalWidth, h: im.naturalHeight });
  const ar = im.naturalHeight / im.naturalWidth;
  let w = kind === 'sign' ? 170 : Math.min(im.naturalWidth * 0.75, 300), h = w * ar;
  if (kind === 'sign' && h > 70) { h = 70; w = h / ar; }
  S.pending = { imgId: id, w, h, kind };
  ghost.src = dataUrl;
  setTool(kind, true);
  toast(kind === 'sign' ? 'Click on the page to place the signature' : 'Click on the page to place the image');
}
async function useImageFile(f) {
  let d = await readAsDataUrl(f);
  if (!/^data:image\/(png|jpeg)/.test(d)) { // convert other formats (webp, gif, …) to PNG
    const im = await loadImg(d); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0); d = c.toDataURL('image/png');
  }
  return d;
}
viewer.addEventListener('pointermove', e => {
  if (!S.pending) return;
  const w = S.pending.w * S.zoom, h = S.pending.h * S.zoom;
  ghost.style.display = 'block'; ghost.style.width = w + 'px'; ghost.style.height = h + 'px';
  ghost.style.left = e.clientX - w / 2 + 'px'; ghost.style.top = e.clientY - h / 2 + 'px';
});
viewer.addEventListener('pointerleave', () => { ghost.style.display = 'none'; });

/* ---------- page operations ---------- */
async function rotatePages(keys, delta) {
  if (!keys.length) return;
  await allPagesReady();
  pushUndo();
  const n = (((delta / 90) % 4) + 4) % 4;
  for (const k of keys) {
    const p = byKey(k);
    for (let i = 0; i < n; i++) {
      const v = vp(p, 1), H = v.height;
      for (const a of p.annots) {
        if (a.type === 'ink') a.points = a.points.map(([x, y]) => [H - y, x]);
        else if (a.type === 'rect') { const { x, y, w, h } = a; Object.assign(a, { x: H - (y + h), y: x, w: h, h: w }); }
        else { const { x, y } = a; a.x = H - y; a.y = x; a.rot = ((a.rot || 0) + 90) % 360; }
      }
      p.extra = (p.extra + 90) % 360;
    }
  }
  rebuild(true);
}
function deletePages(keys) {
  if (!keys.length) return; pushUndo();
  const ks = new Set(keys.map(Number));
  S.pages = S.pages.filter(p => !ks.has(p.key)); ks.forEach(k => S.sel.delete(k));
  S.annSel = null; rebuild(true);
  toast(`${ks.size} page${ks.size > 1 ? 's' : ''} deleted · Ctrl+Z to undo`);
}
function movePages(keys, beforeKey) {
  if (beforeKey != null && keys.has(beforeKey)) return;
  pushUndo();
  const moving = S.pages.filter(p => keys.has(p.key)), rest = S.pages.filter(p => !keys.has(p.key));
  let i = beforeKey == null ? rest.length : rest.findIndex(p => p.key === beforeKey); if (i < 0) i = rest.length;
  rest.splice(i, 0, ...moving); S.pages = rest; rebuild(true);
}
const selectedKeys = () => S.pages.filter(p => S.sel.has(p.key)).map(p => p.key);

/* ---------- thumbnails ---------- */
function thumbClick(e, p) {
  const k = p.key;
  if (e.ctrlKey || e.metaKey) { S.sel.has(k) ? S.sel.delete(k) : S.sel.add(k); }
  else if (e.shiftKey && S.lastSel != null) {
    const a = S.pages.findIndex(q => q.key === S.lastSel), b = S.pages.indexOf(p);
    S.sel = new Set(S.pages.slice(Math.min(a, b), Math.max(a, b) + 1).map(q => q.key));
  } else S.sel = new Set([k]);
  S.lastSel = k; updateThumbSel(); scrollToPage(p);
}
function updateThumbSel() {
  S.pages.forEach(p => p.thumb?.classList.toggle('sel', S.sel.has(p.key)));
  const n = S.sel.size;
  $('#selInfo').textContent = n ? `${n} selected` : `${S.pages.length} page${S.pages.length === 1 ? '' : 's'}`;
  $('#selInfo').title = n ? `${n} of ${S.pages.length} pages selected` : '';
  ['#rotL', '#rotR', '#delPages', '#extract'].forEach(id => $(id).disabled = !n);
}
let dragKeys = null;
function clearDropMarks() { thumbsEl.querySelectorAll('.drop-before,.drop-after').forEach(t => t.classList.remove('drop-before', 'drop-after')); }
function setupThumbDrag(t, p) {
  t.addEventListener('dragstart', e => {
    if (!document.body.classList.contains('editing')) { e.preventDefault(); return; }
    if (!S.sel.has(p.key)) { S.sel = new Set([p.key]); updateThumbSel(); }
    dragKeys = new Set(S.sel); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pdf-pages');
  });
  t.addEventListener('dragend', () => { dragKeys = null; clearDropMarks(); });
  t.addEventListener('dragover', e => {
    if (!dragKeys) return; e.preventDefault();
    const r = t.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    clearDropMarks(); t.classList.add(after ? 'drop-after' : 'drop-before');
  });
  t.addEventListener('drop', e => {
    if (!dragKeys) return; e.preventDefault(); e.stopPropagation();
    const r = t.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    let j = S.pages.indexOf(p) + (after ? 1 : 0);
    while (j < S.pages.length && dragKeys.has(S.pages[j].key)) j++;
    const keys = dragKeys; dragKeys = null; clearDropMarks();
    movePages(keys, j < S.pages.length ? S.pages[j].key : null);
  });
}

/* ---------- zoom & navigation ---------- */
let renderT;
function setZoom(z, anchor) {
  z = Math.min(5, Math.max(0.2, z)); if (Math.abs(z - S.zoom) < 1e-3 || !S.pages.length) { S.zoom = z; updateUI(); return; }
  const vr = viewer.getBoundingClientRect();
  const ay = anchor ? anchor.y - vr.top : viewer.clientHeight / 2;
  const ax = anchor ? anchor.x - vr.left : viewer.clientWidth / 2;
  const y = viewer.scrollTop + ay;
  let ap = S.pages.find(p => p.el.offsetTop + p.el.offsetHeight >= y) || S.pages[S.pages.length - 1];
  const frac = (y - ap.el.offsetTop) / ap.el.offsetHeight;
  const fx = (viewer.scrollLeft + ax) / Math.max(1, viewer.scrollWidth);
  S.zoom = z;
  S.pages.forEach(p => { sizePage(p); renderAnnots(p); });
  viewer.scrollTop = ap.el.offsetTop + frac * ap.el.offsetHeight - ay;
  viewer.scrollLeft = fx * viewer.scrollWidth - ax;
  clearTimeout(renderT); renderT = setTimeout(() => visible.forEach(k => { const p = byKey(k); p && renderPage(p); }), 120);
  updateUI();
}
function fitWidth(max = 5) {
  if (!S.pages.length) return;
  const mw = Math.max(...S.pages.map(p => vp(p, 1).width));
  if (viewer.clientWidth < 250) { setZoom(1); return; }
  setZoom(Math.min(max, (viewer.clientWidth - 56) / mw));
}
function scrollToPage(p) { viewer.scrollTop = p.el.offsetTop - 16; }
let scrollRaf;
viewer.addEventListener('scroll', () => { cancelAnimationFrame(scrollRaf); scrollRaf = requestAnimationFrame(updateCurrent); });
function updateCurrent() {
  if (!S.pages.length) { $('#pageNum').value = 0; return; }
  const line = viewer.scrollTop + viewer.clientHeight * 0.35;
  let cur = S.pages.findIndex(p => p.el.offsetTop + p.el.offsetHeight >= line); if (cur < 0) cur = S.pages.length - 1;
  if (cur !== S.cur || !S.pages[cur].thumb.classList.contains('cur')) {
    S.pages.forEach((p, i) => p.thumb.classList.toggle('cur', i === cur));
    const t = S.pages[cur].thumb, tr = t.getBoundingClientRect(), sr = thumbsEl.getBoundingClientRect();
    if (tr.top < sr.top || tr.bottom > sr.bottom) t.scrollIntoView({ block: 'nearest' });
  }
  S.cur = cur;
  if (document.activeElement !== $('#pageNum')) $('#pageNum').value = cur + 1;
}
viewer.addEventListener('wheel', e => {
  if (!e.ctrlKey) return; e.preventDefault();
  setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX, y: e.clientY });
}, { passive: false });

/* ---------- undo ---------- */
function snap() { return JSON.stringify(S.pages.map(({ key, docId, idx, extra, annots }) => ({ key, docId, idx, extra, annots }))); }
const redoStack = [];
function pushUndo() { undoStack.push(snap()); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; dirty = true; updateUI(); }
function undo() {
  if (!undoStack.length) return;
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  redoStack.push(snap());
  restoreSnap(JSON.parse(undoStack.pop()));
}
function redo() {
  if (!redoStack.length) return;
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  undoStack.push(snap());
  restoreSnap(JSON.parse(redoStack.pop()));
}
function restoreSnap(prev) {
  S.annSel = null;
  const same = prev.length === S.pages.length && prev.every((q, i) => q.key === S.pages[i].key && q.extra === S.pages[i].extra);
  if (same) prev.forEach((q, i) => { S.pages[i].annots = q.annots; renderAnnots(S.pages[i]); });
  else { const keys = new Set(prev.map(q => q.key)); S.sel = new Set([...S.sel].filter(k => keys.has(k))); S.pages = prev; rebuild(true); }
  updateUI();
}

/* ---------- saving ---------- */
async function rasterize(p) {
  const v = vp(p, 2), c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await pdfPage(p).render({ canvasContext: ctx, viewport: v }).promise;
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}
async function buildPdf(pages, opts = {}) {
  await Promise.all([ensurePdfLib(), allPagesReady()]);
  const { PDFDocument, degrees, LineCapStyle, BlendMode } = PDFLib;
  const lib = new Map(); let rasterized = false;
  for (const id of new Set(pages.map(p => p.docId))) {
    let ld = null;
    const opts = { updateMetadata: false, parseSpeed: PDFLib.ParseSpeeds.Fastest };
    try { ld = await PDFDocument.load(await docBytes(id), opts); }
    catch (e) {
      // protected PDFs: decrypted with the password typed when opening (empty for restriction-only files)
      try { ld = await PDFDocument.load(await docBytes(id), { ...opts, password: S.docs.get(id).password || '' }); } catch (e2) { console.warn(e, e2); }
    }
    if (ld && !ld.isEncrypted) { ld.registerFontkit(fontkit); ld._formFilled = await applyForm(ld, id); }
    lib.set(id, ld && !ld.isEncrypted ? ld : null);
  }
  const copied = new Map();
  let out;
  const onlyId = lib.size === 1 ? [...lib.keys()][0] : null, base = onlyId != null ? lib.get(onlyId) : null;
  if (base && pages.length === base.getPageCount() && pages.every((p, i) => p.idx === i)) {
    // Whole document in its original order: edit it in place (keeps the file structure and size).
    out = base;
    const orig = out.getPages();
    pages.forEach((p, i) => copied.set(p.key, orig[i]));
  } else {
    out = await PDFDocument.create();
    for (const [id, ld] of lib) {
      if (!ld) continue;
      const ps = pages.filter(p => p.docId === id);
      if (ld._formFilled) { try { ld.getForm().flatten(); } catch (e) { console.warn('flatten', e); } }   // filled values become page content in the new file
      const cps = await out.copyPages(ld, ps.map(p => p.idx));
      ps.forEach((p, i) => copied.set(p.key, cps[i]));
    }
  }
  out.registerFontkit(fontkit);
  let font = null;
  if (pages.some(p => S.ocr.has(ocrKey(p)) || p.annots.some(a => (a.type === 'text' || a.type === 'note' || a.type === 'edit') && (a.text || '').trim()))) {
    await ensureFont(); if (!fontBytes) throw new Error('Font not loaded');
    font = await out.embedFont(fontBytes, { subset: true });
  }
  const imgCache = new Map();
  const getImg = async id => {
    if (!imgCache.has(id)) { const d = images.get(id).dataUrl; const b = dataUrlBytes(d); imgCache.set(id, d.startsWith('data:image/png') ? await out.embedPng(b) : await out.embedJpg(b)); }
    return imgCache.get(id);
  };
  for (const p of pages) {
    const v1 = vp(p, 1); let pg, conv, R;
    if (copied.has(p.key)) {
      pg = copied.get(p.key); if (out !== base) out.addPage(pg); R = rotOf(p); pg.setRotation(degrees(R));
      conv = (x, y) => v1.convertToPdfPoint(x, y);
      drawOcrText(pg, p, font);   // recognised text of scanned pages, invisible but searchable
    } else { // encrypted / broken source: keep page as image
      rasterized = true;
      const img = await out.embedJpg(await rasterize(p));
      pg = out.addPage([v1.width, v1.height]); pg.drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
      R = 0; conv = (x, y) => [x, v1.height - y];
    }
    for (const a of p.annots) {
      // text, highlights, drawings and notes become real PDF comments (editable in other apps);
      // white-out and signatures/images are always burned into the page
      if (a.type === 'edit') { await drawEdit(out, pg, a, conv, R, font); continue; }   // edited text is always part of the page
      if (!opts.flatten && writeAnnot(out, pg, a, conv, R, font)) continue;
      const rot = a.rot || 0;
      if (a.type === 'note') { drawNoteFlat(pg, a, conv, font); continue; }
      if (a.type === 'text' && a.text.trim()) {
        a.text.replace(/\t/g, '    ').split('\n').forEach((line, i) => {
          if (!line) return;
          const [lx, ly] = rotv(0, (baseRatio + i * 1.2) * a.size, rot);
          const [x, y] = conv(a.x + lx, a.y + ly);
          pg.drawText(line, { x, y, size: a.size, font, color: hexRgb(a.color), rotate: degrees(R - rot) });
        });
      } else if (a.type === 'image') {
        const [lx, ly] = rotv(0, a.h, rot);
        const [x, y] = conv(a.x + lx, a.y + ly);
        pg.drawImage(await getImg(a.imgId), { x, y, width: a.w, height: a.h, rotate: degrees(R - rot) });
      } else if (a.type === 'rect') {
        const c1 = conv(a.x, a.y), c2 = conv(a.x + a.w, a.y + a.h);
        const o = { x: Math.min(c1[0], c2[0]), y: Math.min(c1[1], c2[1]), width: Math.abs(c2[0] - c1[0]), height: Math.abs(c2[1] - c1[1]), color: hexRgb(a.color), opacity: a.opacity, borderWidth: 0 };
        if (a.kind === 'highlight' && BlendMode) o.blendMode = BlendMode.Multiply;
        pg.drawRectangle(o);
      } else if (a.type === 'ink') {
        const pts = a.points.map(([x, y]) => conv(x, y)), col = hexRgb(a.color);
        for (let i = 1; i < pts.length; i++)
          pg.drawLine({ start: { x: pts[i - 1][0], y: pts[i - 1][1] }, end: { x: pts[i][0], y: pts[i][1] }, thickness: a.width, color: col, lineCap: LineCapStyle.Round });
      }
    }
  }
  let compressed = null;
  if (opts.compress) compressed = await compressDoc(out);
  return { bytes: await out.save({ objectsPerTick: Infinity }), rasterized, compressed };
}
async function save(pages = S.pages, suffix = '-edited', opts = {}) {
  if (!pages.length) { toast('Nothing to save'); return; }
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  busy(opts.compress ? 'Compressing…' : 'Saving PDF…');
  let res;
  try { res = await buildPdf(pages, opts); }
  catch (e) { console.error(e); busy(false); toast('Could not create the PDF: ' + e.message, 5000); return; }
  busy(false);
  const name = S.fileName + suffix + '.pdf';
  const saved = await downloadFile(res.bytes, name);
  if (!saved) return;
  if (pages === S.pages) { dirty = false; updateUI(); }
  const shown = typeof saved === 'string' ? saved.split(/[\\/]/).pop() : name;
  const extra = res.compressed ? (res.compressed.count ? ` · ${res.compressed.count} pictures recompressed, ${(res.compressed.saved / 1048576).toFixed(1)} MB smaller` : ' · nothing left to compress') : '';
  toast((res.rasterized ? 'Saved. Pages of the protected PDF were saved as images.' : `Saved ${shown}`) + extra, 4500);
}
async function downloadFile(bytes, name) {
  if (host) {
    const r = await hostCall('saveAs', { name, dir: Cur.path ? dirOf(Cur.path) : '', data: toB64(bytes), filter: 'PDF document|*.pdf' });
    if (r.error) { toast('Could not save: ' + r.error, 5000); return false; }
    return r.path || false;
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }] });
      const w = await h.createWritable(); await w.write(bytes); await w.close(); return true;
    } catch (e) { if (e.name === 'AbortError') return false; console.warn(e); }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

/* ---------- signature dialog ---------- */
const dlg = $('#signDlg'), pad = $('#sigPad'), pctx = pad.getContext('2d');
let sigTab = 'draw', penColor = '#111111', padDirty = false, uploadData = null;
function resetPad() {
  pad.width = 1200; pad.height = 400; pctx.setTransform(2, 0, 0, 2, 0, 0);
  pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.lineWidth = 2.8; padDirty = false;
}
function openSign() {
  if (!S.pages.length) { toast('Open a PDF first'); return; }
  resetPad(); renderSaved(); dlg.showModal();
}
(() => {
  let last = null, lastMid = null;
  const pos = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * 600 / r.width, (e.clientY - r.top) * 200 / r.height]; };
  pad.addEventListener('pointerdown', e => {
    cap(pad, e); last = lastMid = pos(e); padDirty = true;
    pctx.strokeStyle = pctx.fillStyle = penColor; pctx.beginPath(); pctx.arc(last[0], last[1], 1.4, 0, 7); pctx.fill();
  });
  pad.addEventListener('pointermove', e => {
    if (!last) return; const q = pos(e), mid = [(last[0] + q[0]) / 2, (last[1] + q[1]) / 2];
    pctx.beginPath(); pctx.moveTo(lastMid[0], lastMid[1]); pctx.quadraticCurveTo(last[0], last[1], mid[0], mid[1]); pctx.stroke();
    last = q; lastMid = mid;
  });
  const end = () => { last = null; }; pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
})();
function trim(canvas) {
  const ctx = canvas.getContext('2d'), { width: w, height: h } = canvas, d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext('2d').drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
async function typedSig() {
  const txt = $('#sigText').value.trim(); if (!txt) return null;
  await document.fonts.load('120px "Dancing Script"');
  const c = document.createElement('canvas'); c.width = 1600; c.height = 300;
  const x = c.getContext('2d'); x.font = '120px "Dancing Script", cursive'; x.fillStyle = penColor; x.textBaseline = 'middle';
  x.fillText(txt, 30, 150, 1540); return trim(c);
}
function getSaved() { try { return JSON.parse(localStorage.getItem('preview.signatures') || '[]'); } catch { return []; } }
function setSaved(a) { try { localStorage.setItem('preview.signatures', JSON.stringify(a)); } catch { } }
function renderSaved() {
  const list = getSaved(), box = $('#savedSigs'); box.textContent = '';
  $('#savedWrap').hidden = !list.length;
  list.forEach((d, i) => {
    const s = document.createElement('div'); s.className = 's'; s.title = 'Use this signature';
    const im = new Image(); im.src = d; s.append(im);
    const x = document.createElement('button'); x.className = 'x g'; x.textContent = '\uE711'; x.title = 'Remove';
    x.addEventListener('click', e => { e.stopPropagation(); const l = getSaved(); l.splice(i, 1); setSaved(l); renderSaved(); });
    s.append(x); s.addEventListener('click', () => { dlg.close(); useImage(d, 'sign'); }); box.append(s);
  });
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  sigTab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.dataset.tab !== sigTab);
  if (sigTab === 'type') $('#sigText').focus();
}));
document.querySelectorAll('.swatch').forEach(b => b.addEventListener('click', () => {
  penColor = b.dataset.c; document.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b));
  $('#sigPreview').style.color = penColor;
}));
$('#sigText').addEventListener('input', e => { $('#sigPreview').textContent = e.target.value; });
$('#sigClear').addEventListener('click', () => { pctx.clearRect(0, 0, 600, 200); padDirty = false; });
$('#sigFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  uploadData = await useImageFile(f); const pr = $('#sigUploadPrev'); pr.src = uploadData; pr.hidden = false;
});
$('#sigCancel').addEventListener('click', () => dlg.close());
$('#sigUse').addEventListener('click', async () => {
  let d = null;
  if (sigTab === 'draw') d = padDirty ? trim(pad) : null;
  else if (sigTab === 'type') d = await typedSig();
  else d = uploadData;
  if (!d) { toast(sigTab === 'draw' ? 'Sign in the box first' : sigTab === 'type' ? 'Type your name' : 'Choose an image'); return; }
  if (sigTab !== 'upload') { const l = getSaved().filter(x => x !== d); l.unshift(d); setSaved(l.slice(0, 6)); }
  dlg.close(); useImage(d, 'sign');
});

/* ---------- toolbar wiring ---------- */
function updateUI() {
  const has = S.pages.length > 0;
  $('#zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
  $('#pageTotal').textContent = S.pages.length; $('#pageNum').max = S.pages.length;
  $('#btnUndo').disabled = !undoStack.length;
  $('#btnRedo').disabled = !redoStack.length;
  ['#btnSave', '#zoomIn', '#zoomOut', '#zoomFit'].forEach(id => $(id).disabled = !has);
  document.body.classList.toggle('dirty', !!dirty && has);   // Save stays visible while there are unsaved changes
  $('#btnAdd').disabled = !has;
  const pi = $('#pdfInfo'); if (pi) pi.textContent = `${S.pages.length} page${S.pages.length === 1 ? '' : 's'}` + (Cur.path ? ' · ' + dirOf(Cur.path) : '');
  if (document.body.dataset.mode === 'pdf') document.title = has ? `${S.fileName}.pdf${dirty ? ' •' : ''} – Preview` : 'Preview';
}
$('#empty').addEventListener('click', () => openDialog());
$('#btnAdd').addEventListener('click', () => $('#fileAdd').click());
$('#fileOpen').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; openFiles(f, null); });
$('#fileAdd').addEventListener('change', async e => {
  const all = [...e.target.files]; e.target.value = '';
  const imgs = all.filter(f => (f.type || '').startsWith('image/')), pdfs = all.filter(f => !(f.type || '').startsWith('image/'));
  if (imgs.length) { busy('Adding images…'); try { await addPdfPages(await imagesToPdf(imgs), 'Images', S.pages.length); } finally { busy(false); } }
  if (pdfs.length) loadFiles(pdfs, true);
});
$('#fileImg').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) useImage(await useImageFile(f), 'image'); });
document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#btnSave').addEventListener('click', () => save());
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
$('#zoomIn').addEventListener('click', () => setZoom(S.zoom * 1.2));
$('#zoomOut').addEventListener('click', () => setZoom(S.zoom / 1.2));
$('#zoomFit').addEventListener('click', () => fitWidth());
$('#rotL').addEventListener('click', () => rotatePages(selectedKeys(), -90));
$('#rotR').addEventListener('click', () => rotatePages(selectedKeys(), 90));
$('#delPages').addEventListener('click', () => deletePages(selectedKeys()));
$('#extract').addEventListener('click', () => save(S.pages.filter(p => S.sel.has(p.key)), '-pages'));
$('#pageNum').addEventListener('change', e => { const p = S.pages[Math.min(S.pages.length, Math.max(1, +e.target.value)) - 1]; if (p) scrollToPage(p); });
colorInp.addEventListener('input', e => {
  const c = e.target.value, sel = S.annSel;
  if (sel && sel.a.color !== undefined) {
    if (!colorInp._pushed) { pushUndo(); colorInp._pushed = true; }
    sel.a.color = c; renderAnnots(sel.p);
    if (sel.a.type === 'text' || sel.a.type === 'ink') S.color = c;
  } else S.color = c;
});
colorInp.addEventListener('change', () => { colorInp._pushed = false; });
sizeInp.addEventListener('change', e => {
  const v = Math.min(200, Math.max(4, +e.target.value || 14)); e.target.value = v; S.fontSize = v;
  const sel = S.annSel; if (sel?.a.type === 'text' || sel?.a.type === 'edit') { pushUndo(); sel.a.size = v; renderAnnots(sel.p); }
});

/* ---------- keyboard ---------- */
document.addEventListener('keydown', e => {
  const t = e.target, typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const mode = document.body.dataset.mode;
  if (mod && k === 'o') { e.preventDefault(); openDialog(); return; }
  if (k === 'f1') { e.preventDefault(); openKeys(); return; }
  if (mode === 'pdf' && mod && k === 'b') { e.preventDefault(); toggleSidebar(); return; }
  if (mode === 'pdf' && ((mod && k === 'f') || k === 'f3')) {
    e.preventDefault();
    if (k === 'f3' && Find.q) stepFind(e.shiftKey ? -1 : 1); else openFind();
    return;
  }
  if (mode === 'doc') {
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); docZoom(Cur.zoom * 1.15); }
    else if (mod && k === '-') { e.preventDefault(); docZoom(Cur.zoom / 1.15); }
    else if (mod && k === '0') { e.preventDefault(); docZoom(1); }
    else if (!mod && !typing && k === 'n') setNight(!Night.on);
    else if (k === 'f5') { e.preventDefault(); present(); }
    return;
  }
  if (mode !== 'pdf') return;
  if (mod && k === 's') { e.preventDefault(); save(); return; }
  if (mod && k === 'p') { e.preventDefault(); printPdf(); return; }
  if (k === 'f5' && !typing) { e.preventDefault(); present(); return; }
  if (typing || dlg.open) return;
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); setZoom(S.zoom * 1.2); return; }
  if (mod && k === '-') { e.preventDefault(); setZoom(S.zoom / 1.2); return; }
  if (mod && k === '0') { e.preventDefault(); fitWidth(); return; }
  if (mod) return;
  if (k === 'n') { setNight(!Night.on); return; }
  if (k === 'e') { setEditing(!document.body.classList.contains('editing')); return; }
  if (!document.body.classList.contains('editing')) return;
  if ((k === 'delete' || k === 'backspace') && S.annSel) { e.preventDefault(); removeAnnot(S.annSel.p, S.annSel.a); return; }
  if (k === 'delete' && S.sel.size) { deletePages(selectedKeys()); return; }
  if (k === 'escape') { if (S.tool === 'select' && !S.annSel && !S.pending) setEditing(false); else { selectAnnot(null); setTool('select'); } return; }
  if (S.annSel && S.annSel.a.type !== 'ink' && k.startsWith('arrow')) {
    e.preventDefault(); const st = e.shiftKey ? 10 : 1, a = S.annSel.a;
    if (!e.repeat) pushUndo();
    if (k === 'arrowleft') a.x -= st; if (k === 'arrowright') a.x += st; if (k === 'arrowup') a.y -= st; if (k === 'arrowdown') a.y += st;
    renderAnnots(S.annSel.p); return;
  }
  const map = { v: 'select', t: 'text', s: 'sign', i: 'image', w: 'whiteout', h: 'highlight', p: 'pen', c: 'note', d: 'stamp', x: 'edittext' };
  if (map[k]) setTool(map[k]);
});

/* ---------- file drag & drop ---------- */
let dragDepth = 0;
const isFileDrag = e => [...(e.dataTransfer?.types || [])].includes('Files');
const pdfEditDrop = () => document.body.dataset.mode === 'pdf' && document.body.classList.contains('editing') && S.pages.length;
window.addEventListener('dragenter', e => { if (!isFileDrag(e)) return; dragDepth++; const o = $('#dropOverlay'); o.textContent = pdfEditDrop() ? 'Drop to add PDFs at the end or place an image' : 'Drop to open'; o.style.display = 'flex'; });
window.addEventListener('dragleave', e => { if (!isFileDrag(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').style.display = 'none'; } });
window.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!isFileDrag(e)) return; e.preventDefault(); dragDepth = 0; $('#dropOverlay').style.display = 'none';
  const files = [...e.dataTransfer.files];
  if (!files.length) return;
  if (pdfEditDrop()) {
    const img = files.find(f => f.type.startsWith('image/'));
    if (img && !files.some(f => /\.pdf$/i.test(f.name))) { useImageFile(img).then(d => useImage(d, 'image')); return; }
    if (files.every(f => /\.pdf$/i.test(f.name))) { loadFiles(files, true); return; }
  }
  openFiles(files, null);
});
window.addEventListener('beforeunload', e => { if (dirty && !host) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', () => updateCurrent());

/* ================= host bridge, router and document viewers ================= */
const host = window.chrome && window.chrome.webview ? window.chrome.webview : null;
if (host) document.body.classList.add('host');
let reqId = 0; const waiting = new Map();
if (host) host.addEventListener('message', e => { const m = e.data; if (m && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
function hostCall(cmd, data = {}) { return new Promise(res => { const id = ++reqId; waiting.set(id, res); host.postMessage({ ...data, cmd, id }); }); }
function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
const dirOf = p => p.replace(/[\\/][^\\/]*$/, '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
window.isDirty = () => dirty;

const Cur = { path: null, name: '', zoom: 1, kind: null };
const EXT = {
  pdf: 'pdf',
  docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx',
  xlsx: 'sheet', xlsm: 'sheet', xlsb: 'sheet', xls: 'sheet', xltx: 'sheet', ods: 'sheet', fods: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'numbers',
  pptx: 'pptx', ppsx: 'pptx', potx: 'pptx', pptm: 'pptx',
  pages: 'apple', key: 'apple',
  gdoc: 'google', gsheet: 'google', gslides: 'google', gform: 'google', gdraw: 'google',
  txt: 'text', md: 'text', log: 'text', json: 'text', xml: 'text', ini: 'text',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image',
  asice: 'esign', sce: 'esign', bdoc: 'esign', adoc: 'esign', edoc: 'esign',
  doc: 'legacy', dot: 'legacy', ppt: 'legacy', pps: 'legacy', odt: 'legacy', odp: 'legacy', rtf: 'legacy', wps: 'old',
};
const extOf = n => ((n.match(/\.([^.\\/]+)$/) || [])[1] || '').toLowerCase();

function setMode(m) {
  document.body.dataset.mode = m;
  if (m === 'home') { document.title = 'Preview'; renderRecent(); }
}
function setEditing(on) {
  document.body.classList.toggle('editing', !!on);
  $('#btnView').classList.toggle('on', !on); $('#btnEdit').classList.toggle('on', !!on);
  if (on) { ensureFont(); ensurePdfLib().catch(() => { }); }
  if (!on) { selectAnnot(null); setTool('select'); }
}
$('#btnEdit').addEventListener('click', () => { if (!document.body.classList.contains('editing')) setEditing(true); });
$('#btnView').addEventListener('click', () => setEditing(false));

const RANGE_MIN = 8 * 1024 * 1024;
const fileUrl = path => 'https://file.preview/?p=' + encodeURIComponent(path);
async function fetchRange(path, from, to) {
  const r = await fetch(fileUrl(path) + '&from=' + from + '&to=' + to);
  if (!r.ok) throw new Error('read failed');
  return new Uint8Array(await r.arrayBuffer());
}
async function rangeTransport(path, size) {
  const first = await fetchRange(path, 0, Math.min(size, 1 << 20));
  const t = new pdfjsLib.PDFDataRangeTransport(size, first);
  t.requestDataRange = (begin, end) => { fetchRange(path, begin, end).then(chunk => t.onDataRange(begin, chunk)).catch(e => console.warn(e)); };
  return t;
}
async function docBytes(id) {
  const d = S.docs.get(id);
  if (!d.bytes && d.path) d.bytes = new Uint8Array(await (await fetch(fileUrl(d.path))).arrayBuffer());
  return d.bytes;
}
async function openDialog() {
  if (host) { const r = await hostCall('open', { dir: Cur.path ? dirOf(Cur.path) : '' }); if (r.path) openPath(r.path); }
  else $('#fileOpen').click();
}
async function openPath(path) {
  const name = path.split(/[\\/]/).pop();
  busy('Opening…');
  let blob;
  try {
    const early = window.__early && window.__early.path === path ? window.__early.res : null;
    window.__early = null;
    if (extOf(name) === 'pdf' && host) {
      // large PDFs are read piece by piece, so the first page shows without loading the whole file
      const s = await (early || fetch(fileUrl(path) + '&stat=1'));
      if (!s.ok) throw new Error(await s.text());
      const size = +(await s.text());
      if (size > RANGE_MIN) { busy(false); addRecent(path); await openFiles([{ name, rangePath: path, size }], path); return; }
      blob = await (await fetch(fileUrl(path))).blob();
    } else {
      const r = await (early || fetch(fileUrl(path)));
      if (!r.ok) throw new Error(await r.text());
      blob = await r.blob();
    }
    mark('file received');
  } catch (e) {
    busy(false); Cur.path = null;
    setMode('doc'); $('#docName').textContent = name; const inner = $('#docInner'); inner.className = 'center'; inner.innerHTML = '';
    msgCard(inner, '\uE7BA', 'Could not open the file', name + ': ' + e.message);
    return;
  }
  busy(false);
  addRecent(path);
  await openFiles([new File([blob], name)], path);
}
async function openFiles(files, path) {
  if (!files.length) return;
  if (dirty && !confirm('Unsaved PDF changes will be lost. Continue?')) return;
  dirty = false;
  const f = files[0], ext = extOf(f.name), kind = EXT[ext];
  Cur.path = path; Cur.name = f.name; Cur.kind = kind;
  Cur.fromContainer = Cur.pendingContainer || null; Cur.pendingContainer = null;
  try { history.replaceState(null, '', path ? '?path=' + encodeURIComponent(path) : location.pathname); } catch { }
  if (kind === 'pdf') { await loadFiles(files.filter(x => extOf(x.name) === 'pdf'), false); return; }
  if (kind === 'image') { await openImages(files.filter(x => EXT[extOf(x.name)] === 'image'), path); return; }
  await showDoc(f, ext, kind);
}

function msgCard(inner, icon, title, text, openWith, extra) {
  const c = el('div', 'msgCard');
  c.innerHTML = `<div class="ic g">${icon}</div><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="acts"></div>`;
  const acts = c.querySelector('.acts');
  if (openWith && host && Cur.path) addBtn(c, 'Open with another app…', () => hostCall('openWith', { path: Cur.path }));
  if (extra) addBtn(c, extra[0], extra[1], true);
  addBtn(c, 'Open another file', openDialog);
  inner.append(c); return c;
}
function addBtn(card, label, fn, primary) {
  const b = el('button', primary ? 'primary' : ''); b.textContent = label; b.addEventListener('click', fn);
  const acts = card.querySelector('.acts'); primary ? acts.prepend(b) : acts.append(b); return b;
}
function openUrl(u) { if (host) hostCall('external', { url: u }); else window.open(u, '_blank', 'noopener'); }

async function showDoc(f, ext, kind) {
  if (S.pages.length) { S.docs.forEach(d => d.pdf.destroy()); S.docs.clear(); pageInfo.clear(); S.pages = []; rebuild(); }
  setMode('doc'); docZoom(1);
  $('#docName').textContent = f.name; document.title = f.name + ' – Preview';
  const byExt = { pages: 'Pages document', key: 'Keynote presentation', numbers: 'Numbers spreadsheet', csv: 'CSV file', gdoc: 'Google Docs link', gsheet: 'Google Sheets link', gslides: 'Google Slides link',
    doc: 'Word 97–2003 document', dot: 'Word 97–2003 template', rtf: 'RTF document', odt: 'OpenDocument text', ppt: 'PowerPoint 97–2003 presentation', pps: 'PowerPoint 97–2003 show', odp: 'OpenDocument presentation', xls: 'Excel 97–2003 spreadsheet', ods: 'OpenDocument spreadsheet', asice: 'Signed container (ASiC-E)', bdoc: 'Signed container (BDOC)', adoc: 'Signed container (ADOC)', edoc: 'Signed container (eDoc)', sce: 'Signed container' };
  $('#docKind').textContent = (byExt[ext] || KIND_NAMES[kind] || ext.toUpperCase() + ' file') + (Cur.path ? ' · ' + dirOf(Cur.path) : '');
  $('#docPresent').hidden = !(kind === 'pptx' || ['key', 'ppt', 'pps', 'odp'].includes(ext));
  const inner = $('#docInner'); inner.className = ''; inner.innerHTML = ''; $('#docBody').scrollTop = 0;
  $('#docSigBanner').hidden = true; if (Cur.fromContainer) showContainerBanner();
  $('#docPdf').hidden = kind === 'esign';
  busy('Opening…');
  try {
    if (kind === 'docx') await renderDocx(f, inner);
    else if (kind === 'sheet' || kind === 'numbers') await renderSheet(f, inner, ext);
    else if (kind === 'pptx') await renderPptx(f, inner);
    else if (kind === 'apple') await renderApple(f, inner, ext);
    else if (kind === 'google') await renderGoogle(f, inner, ext);
    else if (kind === 'legacy') await renderLegacy(f, inner, ext);
    else if (kind === 'esign') await renderContainer(f, inner, ext);
    else if (kind === 'text') { const pre = el('pre', 'txt'); pre.textContent = await f.text(); inner.append(pre); }
    else if (kind === 'old') { inner.className = 'center'; msgCard(inner, '\uE8A5', 'Legacy file format', `.${ext} files can't be previewed. Open it with another app or save it in a newer format (.docx, .xlsx, .pptx).`, true); }
    else { inner.className = 'center'; msgCard(inner, '\uE9CE', 'Unsupported file type', `"${f.name}" can't be shown in Preview.`, true); }
  } catch (e) {
    console.error(e); inner.innerHTML = ''; inner.className = 'center';
    msgCard(inner, '\uE7BA', 'Could not display the file', (e && e.message) || String(e), true);
  } finally { busy(false); }
}

/* ---- Word ---- */
async function renderDocx(f, inner) {
  await loadLib('lib/jszip.min.js'); await loadLib('lib/docx-preview.min.js');
  inner.className = 'center';
  const box = el('div'); inner.append(box);
  await docx.renderAsync(await f.arrayBuffer(), box, null, {
    inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true, experimental: true, useBase64URL: true,
    renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
  });
}

/* ---- Excel / spreadsheets ---- */
async function renderSheet(f, inner, ext) {
  await loadLib('lib/xlsx.full.min.js');
  let wb; const ab = await f.arrayBuffer();
  try { wb = XLSX.read(ab, { type: 'array', cellDates: true }); }
  catch (e) { if (ext === 'numbers') return renderApple(f, inner, ext); throw e; }
  // Excel files: colours, fonts, borders, row/column sizes, charts and pictures (sheetx.js)
  let extras = null;
  if (/^(xlsx|xlsm|xltx)$/.test(ext) && ab.byteLength < 15e6) { try { extras = await excelExtras(ab); } catch (e) { console.warn('excel extras', e); } }
  inner.className = 'sheet';
  const note = el('div', 'sheetNote'), scroll = el('div', 'sheetScroll'), tabs = el('div', 'sheetTabs');
  note.hidden = true; inner.append(note, scroll, tabs);
  if (extras) scroll.classList.add('xl');   // formatted workbooks are shown on white paper, like Excel
  const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
  const visibleIdx = wb.SheetNames.map((n, i) => i).filter(i => !(meta[i] && meta[i].Hidden));
  const show = i => {
    [...tabs.children].forEach(b => b.classList.toggle('active', +b.dataset.i === i));
    drawSheet(wb.Sheets[wb.SheetNames[i]], scroll, note, extras && extras.get(wb.SheetNames[i])); scroll.scrollTop = scroll.scrollLeft = 0;
  };
  visibleIdx.forEach(i => { const b = el('button'); b.textContent = wb.SheetNames[i]; b.dataset.i = i; b.addEventListener('click', () => show(i)); tabs.append(b); });
  if (visibleIdx.length < 2) tabs.hidden = true;
  show(visibleIdx.length ? visibleIdx[0] : 0);
}
function drawSheet(ws, box, note, x) {
  const drawings = (x && x.drawings) || [];
  if ((!ws || !ws['!ref']) && !drawings.length) { box.innerHTML = '<div class="msgCard"><p>This sheet is empty.</p></div>'; note.hidden = true; return; }
  const rg = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  // make room for charts and pictures placed beyond the data
  for (const d of drawings) { rg.e.r = Math.max(rg.e.r, d.to.r + 1); rg.e.c = Math.max(rg.e.c, d.to.c + 1); }
  const R = Math.min(rg.e.r, 4999), C = Math.min(rg.e.c, 199);
  const cut = rg.e.r > R || rg.e.c > C;
  note.hidden = !cut;
  if (cut) note.textContent = `Showing the first ${R + 1} rows and ${C + 1} columns (of ${rg.e.r + 1} × ${rg.e.c + 1}).`;
  const span = new Map(), covered = new Set();
  for (const m of (ws && ws['!merges']) || []) {
    span.set(m.s.r + ',' + m.s.c, [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1]);
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(r + ',' + c);
  }
  const cols = (ws && ws['!cols']) || [], rows = (ws && ws['!rows']) || [];
  const xc = x ? x.colW : [], xr = x ? x.rowH : [], xs = x ? x.cells : null;
  const h = ['<div class="sheetCanvas"><table class="grid"><colgroup><col style="width:46px">'];
  for (let c = 0; c <= C; c++) {
    const ci = cols[c]; let w = 80;
    if (ci) w = ci.hidden ? 0 : (ci.wpx || (ci.wch ? ci.wch * 7 + 10 : 0) || (ci.width ? ci.width * 7 : 0) || 80);
    if (xc[c] != null) w = xc[c];
    h.push(`<col style="width:${Math.round(w)}px">`);
  }
  h.push('</colgroup><thead><tr><th class="corner"></th>');
  for (let c = 0; c <= C; c++) h.push('<th>' + XLSX.utils.encode_col(c) + '</th>');
  h.push('</tr></thead><tbody>');
  for (let r = 0; r <= R; r++) {
    const ri = rows[r]; if (ri && ri.hidden) continue;
    const rh = xr[r] != null ? xr[r] : ri && ri.hpx ? ri.hpx : 0;
    h.push(`<tr data-r="${r}"${rh ? ` style="height:${Math.round(rh)}px"` : ''}><th>${r + 1}</th>`);
    for (let c = 0; c <= C; c++) {
      const k = r + ',' + c; if (covered.has(k)) continue;
      const cell = ws ? ws[XLSX.utils.encode_cell({ r, c })] : null, sp = span.get(k);
      const txt = cell ? (cell.w != null ? cell.w : cell.v != null ? String(cell.v) : '') : '';
      const num = cell && (cell.t === 'n' || cell.t === 'd');
      const st = xs && xs.get(k);
      h.push(`<td${num ? ' class="n"' : ''}${st ? ` style="${st}"` : ''}${sp ? ` rowspan="${sp[0]}" colspan="${sp[1]}"` : ''}${txt.length > 10 ? ` title="${esc(txt)}"` : ''}>${esc(txt)}</td>`);
    }
    h.push('</tr>');
  }
  h.push('</tbody></table></div>');
  box.innerHTML = h.join('');
  if (drawings.length) placeDrawings(box.querySelector('.sheetCanvas'), drawings);
}

/* ---- PowerPoint ---- */
async function renderPptx(f, inner) {
  await loadLib('lib/pptx-preview.umd.js');
  inner.className = 'center';
  const box = el('div', 'pptx-host'); inner.append(box);
  const w = Math.round(Math.min(1280, Math.max(480, $('#docBody').clientWidth - 64)));
  const pv = pptxPreview.init(box, { width: w, height: Math.round(w * 9 / 16) });
  await pv.preview(await f.arrayBuffer());
}

/* ---- Apple Pages / Numbers / Keynote ---- */
async function renderApple(f, inner, ext) {
  await loadLib('lib/jszip.min.js');
  const label = { pages: 'Pages', numbers: 'Numbers', key: 'Keynote' }[ext] || '';
  const icloud = ['Open iCloud.com', () => openUrl('https://www.icloud.com/')];
  inner.className = 'center';
  let zip;
  try { zip = await JSZip.loadAsync(await f.arrayBuffer()); }
  catch { msgCard(inner, '\uE8A5', `Could not read this ${label} file`, 'It may be a Mac package (a folder) or damaged. Ask the sender to export it as PDF, Word, Excel or PowerPoint.', true, icloud); return; }
  const pdfEntry = zip.file(/(^|\/)QuickLook\/Preview\.pdf$/i)[0];
  if (pdfEntry) {
    const b = await pdfEntry.async('uint8array');
    await loadFiles([new File([b], f.name.replace(/\.\w+$/, '') + '.pdf', { type: 'application/pdf' })], false);
    toast('Showing the PDF copy stored in the file'); return;
  }
  const previews = zip.file(/(^|\/)(preview|QuickLook\/Thumbnail|thumbnail)\.(jpe?g|png)$/i);
  previews.sort((a, b) => ((b._data && b._data.uncompressedSize) || 0) - ((a._data && a._data.uncompressedSize) || 0));
  const blobUrl = async path => URL.createObjectURL(await zip.file(path).async('blob'));
  if (ext === 'pages' || ext === 'key') {
    try {
      await loadLib('lib/iwork.js');
      if (ext === 'pages') {
        const { blocks } = await iWork.readPages(zip);
        if (blocks.some(b => b.text)) { await drawPages(inner, blocks, blobUrl, previews[0]); return; }
      } else {
        const { slides } = await iWork.readKeynote(zip);
        if (slides.length) { await drawKeynote(inner, slides, blobUrl, previews[0]); return; }
      }
    } catch (e) { console.warn('iWork', e); }
  }
  msgCard(inner, '\uE8A5', `Apple ${label} file`,
    previews.length ? `The content couldn't be read, so only a picture of the first ${ext === 'key' ? 'slide' : 'page'} is shown.`
      : 'The content couldn\'t be read. Open it in an Apple app or on iCloud.com.', true, icloud);
  if (previews.length) { const im = el('img', 'applePrev'); im.src = await blobUrl(previews[0].name); inner.append(im); }
}
function appleNote(inner, text, preview, blobUrl) {
  const n = el('div', 'iwNote'); const s = el('span'); s.textContent = text; n.append(s);
  if (preview) {
    const b = el('button'); b.textContent = 'Original preview';
    b.title = 'Show the first-page image saved by the Apple app';
    let shown = null;
    b.addEventListener('click', async () => {
      if (shown) { shown.remove(); shown = null; b.textContent = 'Original preview'; return; }
      shown = el('img', 'applePrev'); shown.src = await blobUrl(preview.name); shown.style.display = 'block'; shown.style.margin = '0 auto 16px';
      n.after(shown); b.textContent = 'Hide preview';
    });
    n.append(b);
  }
  inner.append(n);
}
async function drawPages(inner, blocks, blobUrl, preview) {
  inner.className = '';
  appleNote(inner, 'Simplified Pages view: text, headings and images. The layout may differ from the original.', preview, blobUrl);
  const doc = el('article', 'iwDoc');
  const tag = { h1: 'h1', h2: 'h2', h3: 'h3', quote: 'blockquote', cap: 'p', p: 'p' };
  for (const b of blocks) {
    if (b.t === 'img') { const im = el('img'); im.src = await blobUrl(b.path); im.loading = 'lazy'; doc.append(im); }
    else if (b.t === 'hr') doc.append(el('hr'));
    else { const e = el(tag[b.t] || 'p', b.t === 'cap' ? 'cap' : ''); e.textContent = b.text; doc.append(e); }
  }
  inner.append(doc);
}
async function drawKeynote(inner, slides, blobUrl, preview) {
  inner.className = '';
  appleNote(inner, 'Simplified Keynote view: slide pictures (low resolution) and their text.', null, blobUrl);
  const box = el('div', 'kSlides');
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i], card = el('section', 'kSlide');
    const num = el('div', 'num'); num.textContent = `Slide ${i + 1} of ${slides.length}`; card.append(num);
    const src = i === 0 && preview ? preview.name : s.thumb;
    if (src) { const im = el('img'); im.src = await blobUrl(src); im.loading = 'lazy'; card.append(im); }
    if (s.blocks.length) {
      const txt = el('div', 'txt');
      for (const grp of s.blocks) {
        const g = el('div', 'grp');
        for (const b of grp) { const e = el(/^h[123]$/.test(b.t) ? b.t : 'p'); e.textContent = b.text; g.append(e); }
        txt.append(g);
      }
      card.append(txt);
    }
    box.append(card);
  }
  inner.append(box);
}

/* ---- Google Docs / Sheets / Slides shortcuts ---- */
async function renderGoogle(f, inner, ext) {
  let j = {}; try { j = JSON.parse(await f.text()); } catch { }
  const id = j.doc_id || String(j.resource_id || '').split(':').pop();
  const kinds = {
    gdoc: ['https://docs.google.com/document/d/', 'Google Docs document', 'export?format=pdf', 'pdf'],
    gsheet: ['https://docs.google.com/spreadsheets/d/', 'Google Sheets spreadsheet', 'export?format=xlsx', 'xlsx'],
    gslides: ['https://docs.google.com/presentation/d/', 'Google Slides presentation', 'export/pdf', 'pdf'],
    gform: ['https://docs.google.com/forms/d/', 'Google Forms form'],
    gdraw: ['https://docs.google.com/drawings/d/', 'Google Drawing', 'export/pdf', 'pdf'],
  };
  const k = kinds[ext] || [];
  let url = typeof j.url === 'string' && /^https:\/\//i.test(j.url) ? j.url : (id && k[0] ? k[0] + encodeURIComponent(id) + '/edit' : '');
  const rk = j.resource_key ? 'resourcekey=' + encodeURIComponent(j.resource_key) : '';
  if (url && rk && !/resourcekey=/i.test(url)) url += (url.includes('?') ? '&' : '?') + rk;
  const label = k[1] || 'Google file';
  inner.className = 'center';
  if (!url) { msgCard(inner, '\uE71B', label, 'This file is only a link, and no address could be found in it.', true); return; }
  // Try to download the document itself (works when it is shared "anyone with the link")
  if (host && id && k[2]) {
    busy('Downloading from Google…');
    try {
      const exp = k[0] + encodeURIComponent(id) + '/' + k[2] + (rk ? (k[2].includes('?') ? '&' : '?') + rk : '');
      const r = await fetch('https://file.preview/?u=' + encodeURIComponent(exp));
      if (r.ok) {
        const blob = await r.blob();
        const name = f.name.replace(/\.\w+$/, '') + '.' + k[3];
        busy(false);
        if (k[3] === 'pdf') await loadFiles([new File([blob], name, { type: 'application/pdf' })], false);
        else { $('#docName').textContent = f.name; inner.className = ''; await renderSheet(new File([blob], name), inner, 'xlsx'); }
        toast('Downloaded from Google – this is a copy. Edit the original in your browser.', 4500);
        return;
      }
    } catch (e) { console.warn(e); }
    finally { busy(false); }
  }
  msgCard(inner, '\uE71B', label,
    'Google files live in the cloud and this file is only a link to one. The document isn\'t shared publicly, so it was opened in your browser, where you\'re signed in to Google.',
    false, ['Open in browser again', () => openUrl(url)]);
  openUrl(url);
}

/* ---- document viewer toolbar ---- */
function docZoom(z) {
  Cur.zoom = Math.min(4, Math.max(0.3, z));
  $('#docInner').style.setProperty('--z', Cur.zoom);
  $('#docZoomLabel').textContent = Math.round(Cur.zoom * 100) + '%';
}
$('#docZoomIn').addEventListener('click', () => docZoom(Cur.zoom * 1.15));
$('#docZoomOut').addEventListener('click', () => docZoom(Cur.zoom / 1.15));
$('#docZoomLabel').addEventListener('click', () => docZoom(1));
$('#docBody').addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); docZoom(Cur.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
document.querySelectorAll('.openAny').forEach(b => b.addEventListener('click', openDialog));
$('#homeDrop').addEventListener('click', openDialog);

/* ---- theme & night reading ---- */
const Theme = { mode: 'auto' };
const Night = { on: false };
try { Theme.mode = localStorage.getItem('preview.theme') || 'auto'; Night.on = localStorage.getItem('preview.night') === '1'; } catch { }
const themeNames = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const darkMq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = Theme.mode === 'dark' || (Theme.mode === 'auto' && darkMq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === Theme.mode));
  if (host) host.postMessage({ cmd: 'theme', dark });
}
function setThemeMode(m) {
  Theme.mode = m in themeNames ? m : 'auto';
  try { localStorage.setItem('preview.theme', Theme.mode); } catch { }
  applyTheme();
}
darkMq.addEventListener('change', applyTheme);
// keep every open window in step when the theme or night mode is changed in another one
window.addEventListener('storage', e => {
  if (e.key === 'preview.theme') { Theme.mode = e.newValue || 'auto'; applyTheme(); }
  if (e.key === 'preview.night' && (e.newValue === '1') !== Night.on) {
    Night.on = e.newValue === '1'; document.body.classList.toggle('night', Night.on); if (S.pages.length) rebuild(true);
  }
});
document.querySelectorAll('#themeSeg button').forEach(b => b.addEventListener('click', () => setThemeMode(b.dataset.t)));
function setNight(on) {
  Night.on = !!on; document.body.classList.toggle('night', Night.on);
  try { localStorage.setItem('preview.night', Night.on ? '1' : '0'); } catch { }
  if (S.pages.length) rebuild(true);
  toast(Night.on ? 'Night reading on' : 'Night reading off', 1600);
}
document.querySelectorAll('.nightBtn').forEach(b => b.addEventListener('click', () => setNight(!Night.on)));
document.body.classList.toggle('night', Night.on);
applyTheme();

/* ---- recent files ---- */
function getRecent() { try { return JSON.parse(localStorage.getItem('preview.recent') || '[]'); } catch { return []; } }
function addRecent(p) {
  const l = getRecent().filter(x => x.toLowerCase() !== p.toLowerCase()); l.unshift(p);
  try { localStorage.setItem('preview.recent', JSON.stringify(l.slice(0, 12))); } catch { }
}
const KIND_NAMES = { pdf: 'PDF document', docx: 'Word document', sheet: 'Spreadsheet', numbers: 'Numbers spreadsheet', pptx: 'PowerPoint presentation', apple: 'Apple document', google: 'Google link', text: 'Text file', old: 'Legacy document', esign: 'Signed container' };
function badgeFor(ext) {
  const k = EXT[ext], b = el('span', 'badge');
  const legacy = /^(doc|dot|rtf|odt)$/.test(ext) ? ['word', 'W'] : /^(ppt|pps|odp)$/.test(ext) ? ['ppt', 'P'] : null;
  const m = legacy || { pdf: ['pdf', 'PDF'], docx: ['word', 'W'], sheet: ['excel', 'X'], numbers: ['apple', 'N'], pptx: ['ppt', 'P'], apple: ['apple', ext === 'key' ? 'K' : 'P'], google: ['google', 'G'], image: ['other', 'IMG'], esign: ['esign', 'SIG'] }[k] || ['other', (ext || '?').slice(0, 3).toUpperCase()];
  b.classList.add(m[0]); b.textContent = m[1]; return b;
}
function renderRecent() {
  const l = host ? getRecent().slice(0, 8) : [], box = $('#recent');
  $('#recentWrap').hidden = !l.length; box.textContent = '';
  l.forEach(p => {
    const b = el('button'), n = el('span', 'rn'), d = el('span', 'rp');
    n.textContent = p.split(/[\\/]/).pop(); d.textContent = dirOf(p); b.title = p;
    b.append(badgeFor(extOf(p)), n, d); b.addEventListener('click', () => openPath(p)); box.append(b);
  });
}

updateUI(); updateThumbSel();
// Start loading the viewer for this file type while the file itself is being read.
function prefetchFor(ext) {
  const jobs = {
    pdf: () => ensurePdfJs(),
    docx: () => loadLib('lib/jszip.min.js').then(() => loadLib('lib/docx-preview.min.js')),
    sheet: () => loadLib('lib/xlsx.full.min.js'), numbers: () => loadLib('lib/xlsx.full.min.js'),
    pptx: () => loadLib('lib/pptx-preview.umd.js'),
    apple: () => loadLib('lib/jszip.min.js').then(() => loadLib('lib/iwork.js')),
  };
  const job = jobs[EXT[ext]]; if (job) job().catch(() => { });
}
const startPath = new URLSearchParams(location.search).get('path');
if (startPath && host) { prefetchFor(extOf(startPath)); openPath(startPath); } else setMode('home');
