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
