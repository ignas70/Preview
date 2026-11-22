'use strict';
/* Preview – PDF reading features: selectable text, links, form filling, search, contents (outline),
   resume position, password-protected files, blank pages and images → PDF. */

/* ================= page layers: text, search highlights, links, form fields ================= */
// Called by renderPage() after a page's canvas has been drawn at the current zoom.
async function pageExtras(p) {
  const pg = await realPage(p).catch(() => null);
  if (!pg || !p.el || !p.el.isConnected) return;
  const v = vp(p, S.zoom), key = S.zoom + '|' + rotOf(p);
  if (p.extrasFor === key) { drawHighlights(p); return; }
  p.extrasFor = key;
  for (const c of ['textLayer', 'hlLayer', 'linkLayer', 'formLayer']) p.el.querySelector('.' + c)?.remove();
  const mk = cls => { const d = el('div', cls); d.style.setProperty('--scale-factor', S.zoom); p.el.insertBefore(d, p.el.querySelector('.layer')); return d; };
  const tl = mk('textLayer'), hl = mk('hlLayer'), ll = mk('linkLayer');
  try {
    pg._tc = pg._tc || await pg.getTextContent();
    await pdfjsLib.renderTextLayer({ textContentSource: pg._tc, container: tl, viewport: v, textDivs: [] }).promise;
  } catch (e) { console.warn('text layer', e); }
  if (S.ocr.has(ocrKey(p))) ocrTextLayer(p, tl, v);
  try {
    pg._an = pg._an || await pg.getAnnotations({ intent: 'display' });
    for (const a of pg._an) {
      if (a.subtype === 'Link' && (a.url || a.unsafeUrl || a.dest)) {
        const r = rectOf(v, a.rect), lk = el('a', 'lnk');
        Object.assign(lk.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        const url = a.url || a.unsafeUrl;
        lk.title = url || 'Go to destination';
        lk.addEventListener('click', ev => { ev.preventDefault(); if (url) openUrl(url); else goToDest(p.docId, a.dest); });
        ll.append(lk);
      }
    }
    // comments already in the file: show their text on hover
    for (const a of pg._an) {
      const txt = a.contentsObj && a.contentsObj.str;
      if (!txt || a.subtype === 'Link' || a.subtype === 'Widget' || a.subtype === 'Popup') continue;
      const r = rectOf(v, a.rect), tip = el('div', 'atip');
      const who = a.titleObj && a.titleObj.str;
      tip.addEventListener('pointerenter', () => showNotePop(tip, txt, { title: who || 'Comment' }));
      tip.addEventListener('pointerleave', () => hideNotePop(250));
      Object.assign(tip.style, { left: r.x + 'px', top: r.y + 'px', width: Math.max(12, r.w) + 'px', height: Math.max(12, r.h) + 'px' });
      ll.append(tip);
    }
    const widgets = pg._an.filter(a => a.subtype === 'Widget' && a.fieldName && !a.hidden && ['Tx', 'Btn', 'Ch'].includes(a.fieldType) && !a.pushButton);
    if (widgets.length) drawForm(p, mk('formLayer'), v, widgets);
  } catch (e) { console.warn('annotations', e); }
  drawHighlights(p);
}
function rectOf(v, r) {
  const [x1, y1, x2, y2] = v.convertToViewportRectangle(r);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/* ---- links and destinations ---- */
async function goToDest(docId, dest) {
  const d = S.docs.get(docId); if (!d) return;
  try {
    const explicit = typeof dest === 'string' ? await d.pdf.getDestination(dest) : dest;
    if (!explicit) return;
    const ref = explicit[0];
    const idx = typeof ref === 'object' && ref ? await d.pdf.getPageIndex(ref) : +ref;
    const p = S.pages.find(q => q.docId === docId && q.idx === idx); if (!p) return;
    let y = 0;
    if (explicit[1] && explicit[1].name === 'XYZ' && explicit[3] != null) {
      await realPage(p); y = Math.max(0, vp(p, S.zoom).convertToViewportPoint(0, explicit[3])[1] - 12);
    }
    viewer.scrollTop = p.el.offsetTop + y - 8;
  } catch (e) { console.warn('dest', e); }
}

/* ================= form filling ================= */
S.form = new Map();      // "docId|fieldName" -> value (text, true/false, or the chosen option)
S.formChanged = new Set();
function drawForm(p, layer, v, widgets) {
  for (const a of widgets) {
    const r = rectOf(v, a.rect), id = p.docId + '|' + a.fieldName;
    if (!S.form.has(id)) S.form.set(id, initialValue(a));
    const val = S.form.get(id);
    let inp;
    if (a.fieldType === 'Tx') {
      inp = el(a.multiLine ? 'textarea' : 'input');
      if (!a.multiLine) inp.type = a.password ? 'password' : 'text';
      inp.value = val ?? '';
      if (a.maxLen) inp.maxLength = a.maxLen;
      const fs = a.textFormat?.fontSize || a.defaultAppearanceData?.fontSize || 0;
      inp.style.fontSize = (fs ? fs * S.zoom : Math.min(r.h * 0.7, 14 * S.zoom)) + 'px';
      if (a.textAlignment === 1) inp.style.textAlign = 'center'; else if (a.textAlignment === 2) inp.style.textAlign = 'right';
      inp.addEventListener('input', () => setField(id, inp.value, inp));
    } else if (a.fieldType === 'Btn') {
      inp = el('input');
      inp.type = a.radioButton ? 'radio' : 'checkbox';
      if (a.radioButton) { inp.name = 'r' + id; inp.checked = val === a.buttonValue; inp.addEventListener('change', () => inp.checked && setField(id, a.buttonValue, inp)); }
      else { inp.checked = !!val; inp.addEventListener('change', () => setField(id, inp.checked, inp)); }
      inp.dataset.button = a.buttonValue || '';
    } else {
      inp = el('select');
      if (a.multiSelect) inp.multiple = true;
      for (const o of a.options || []) { const op = el('option'); op.value = o.exportValue; op.textContent = o.displayValue; inp.append(op); }
      inp.value = Array.isArray(val) ? val[0] : (val ?? '');
      inp.addEventListener('change', () => setField(id, inp.value, inp));
    }
    inp.className = 'ff ' + (a.fieldType === 'Btn' ? 'ffb' : 'fft');
    inp.dataset.field = id;
    if (a.readOnly) inp.disabled = true;
    inp.title = a.alternativeText || a.fieldName;
    Object.assign(inp.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    layer.append(inp);
  }
}
function initialValue(a) {
  if (a.fieldType === 'Btn') return a.radioButton ? (a.fieldValue && a.fieldValue !== 'Off' ? a.fieldValue : null) : (!!a.fieldValue && a.fieldValue !== 'Off');
  if (a.fieldType === 'Ch') return Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue;
  return a.fieldValue ?? '';
}
function setField(id, value, source) {
  S.form.set(id, value); S.formChanged.add(id);
  if (!dirty) { dirty = true; updateUI(); }
  // keep other widgets of the same field (on other pages) in step
  for (const o of document.querySelectorAll('.ff')) {
    if (o === source || o.dataset.field !== id) continue;
    if (o.type === 'checkbox') o.checked = !!value;
    else if (o.type === 'radio') o.checked = o.dataset.button === value;
    else o.value = value;
  }
}
// Writes the filled-in values into a pdf-lib document. Returns true if anything was changed.
async function applyForm(ld, docId) {
  const ids = [...S.formChanged].filter(k => k.startsWith(docId + '|'));
  if (!ids.length) return false;
  const form = ld.getForm();
  for (const id of ids) {
    const name = id.slice(id.indexOf('|') + 1), v = S.form.get(id);
    let f; try { f = form.getField(name); } catch { continue; }
    try {
      if (f instanceof PDFLib.PDFTextField) f.setText(String(v ?? ''));
      else if (f instanceof PDFLib.PDFCheckBox) v ? f.check() : f.uncheck();
      else if (f instanceof PDFLib.PDFRadioGroup) {
        // pdf.js may report the option by its index ("0", "1", …) when the field has an /Opt list
        const opts = f.getOptions(); let o = v;
        if (o != null && !opts.includes(o) && /^\d+$/.test(o) && opts[+o] != null) o = opts[+o];
        if (o != null && opts.includes(o)) f.select(o); else if (!o) f.clear();
      }
      else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) { if (v) f.select(v); }
    } catch (e) { console.warn('field', name, e); }
  }
  await ensureFont();
  try { form.updateFieldAppearances(await ld.embedFont(fontBytes, { subset: true })); } catch (e) { console.warn('appearances', e); }
  return true;
}

/* ================= search ================= */
const Find = { q: '', list: [], byKey: new Map(), cur: -1, token: 0 };
const foldChar = c => c.normalize('NFD')[0].toLowerCase();
const fold = s => { let o = ''; for (let i = 0; i < s.length; i++) o += foldChar(s[i]); return o; };   // same length as s
async function pageText(p) {
  const pg = await realPage(p);
  if (!pg._txt && typeof ocrPageText === 'function' && S.ocr.has(ocrKey(p))) pg._txt = ocrPageText(p);
  if (!pg._txt) {
    pg._tc = pg._tc || await pg.getTextContent();
    let s = ''; const starts = [];
    for (const it of pg._tc.items) { starts.push(s.length); s += it.str || ''; if (it.hasEOL) s += ' '; }
    pg._txt = { s, n: fold(s), starts, items: pg._tc.items };
  }
  return pg._txt;
}
function openFind() {
  if (!S.pages.length) return;
  const bar = $('#findBar'); bar.hidden = false;
  const inp = $('#findInput'); inp.focus(); inp.select();
}
function closeFind() {
  $('#findBar').hidden = true; Find.q = ''; Find.token++; Find.list = []; Find.byKey.clear(); Find.cur = -1;
  document.querySelectorAll('.hlLayer').forEach(h => h.textContent = '');
  $('#findCount').textContent = '';
}
let findT;
async function runFind(q) {
  const tok = ++Find.token;
  Find.q = q; Find.list = []; Find.byKey.clear(); Find.cur = -1;
  document.querySelectorAll('.hlLayer').forEach(h => h.textContent = '');
  const count = $('#findCount');
  if (!q.trim()) { count.textContent = ''; return; }
  const nq = fold(q);
  count.textContent = 'Searching…';
  // start from the current page so the first hit is the nearest one
  const order = S.pages.map((p, i) => S.pages[(i + S.cur) % S.pages.length]);
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    let t; try { t = await pageText(p); } catch { continue; }
    if (tok !== Find.token) return;
    let from = 0, k; const mine = [];
    while ((k = t.n.indexOf(nq, from)) >= 0) { mine.push({ p, start: k, end: k + nq.length }); from = k + nq.length; }
    if (mine.length) {
      Find.byKey.set(p.key, mine);
      if (Find.cur < 0) { Find.list = mine.slice(); Find.cur = 0; goToMatch(0); }
    }
    if (i % 25 === 24) { await new Promise(r => setTimeout(r)); count.textContent = `Searching… ${Find.byKey.size ? '' : ''}`; }
  }
  if (tok !== Find.token) return;
  // final list in document order
  const cur = Find.list[Find.cur];
  Find.list = S.pages.flatMap(p => Find.byKey.get(p.key) || []);
  Find.cur = cur ? Find.list.indexOf(cur) : -1;
  updateFindCount();
  document.querySelectorAll('.page').forEach(pe => { const p = byKey(pe.dataset.key); if (p) drawHighlights(p); });
}
function updateFindCount() {
  const n = Find.list.length;
  $('#findCount').textContent = !Find.q ? '' : n ? `${Find.cur + 1} of ${n}` : 'No results';
  $('#findInput').classList.toggle('none', !!Find.q && !n);
}
function stepFind(d) {
  if (!Find.list.length) return;
  Find.cur = (Find.cur + d + Find.list.length) % Find.list.length;
  goToMatch(Find.cur); updateFindCount();
}
async function goToMatch(i) {
  const m = Find.list[i]; if (!m) return;
  const t = await pageText(m.p);
  const rects = matchRects(m.p, t, m);
  const y = rects.length ? rects[0].y : 0;
  viewer.scrollTop = m.p.el.offsetTop + y - viewer.clientHeight / 3;
  // page sizes can still settle while pages load; correct once more
  setTimeout(() => { if (Find.list[Find.cur] === m) viewer.scrollTop = m.p.el.offsetTop + y - viewer.clientHeight / 3; }, 150);
  document.querySelectorAll('.page').forEach(pe => { const p = byKey(pe.dataset.key); if (p) drawHighlights(p); });
}
function matchRects(p, t, m) {
  const v = vp(p, S.zoom), out = [];
  t.items.forEach((it, j) => {
    const s0 = t.starts[j], len = (it.str || '').length;
    const a = Math.max(m.start, s0), b = Math.min(m.end, s0 + len);
    if (a >= b || !len) return;
    if (it.ocrRect) {   // recognised word: share of the word box
      const r = rectOf(v, it.ocrRect), n = len - 1 || 1;
      out.push({ x: r.x + r.w * (a - s0) / n, y: r.y, w: r.w * (Math.min(b - s0, n) - (a - s0)) / n, h: r.h });
      return;
    }
    const [sx, , , sy, tx, ty] = it.transform;
    const fh = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    const x0 = tx + it.width * (a - s0) / len, x1 = tx + it.width * (b - s0) / len;
    out.push(rectOf(v, [x0, ty - fh * 0.22, x1, ty + fh * 0.88]));
  });
  return out;
}
async function drawHighlights(p) {
  const layer = p.el && p.el.querySelector('.hlLayer'); if (!layer) return;
  layer.textContent = '';
  const mine = Find.byKey.get(p.key); if (!mine || !Find.q) return;
  const t = await pageText(p).catch(() => null); if (!t) return;
  const current = Find.list[Find.cur];
  for (const m of mine) for (const r of matchRects(p, t, m)) {
    const d = el('div', 'hl' + (m === current ? ' cur' : ''));
    Object.assign(d.style, { left: r.x - 1 + 'px', top: r.y + 'px', width: r.w + 2 + 'px', height: r.h + 'px' });
    layer.append(d);
  }
}
$('#findInput').addEventListener('input', e => { clearTimeout(findT); const q = e.target.value; findT = setTimeout(() => runFind(q), 180); });
$('#findInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  e.stopPropagation();
});
$('#findPrev').addEventListener('click', () => stepFind(-1));
$('#findNext').addEventListener('click', () => stepFind(1));
$('#findClose').addEventListener('click', closeFind);
$('#btnFind').addEventListener('click', openFind);

/* ================= contents (outline) ================= */
async function loadOutline() {
  const box = $('#outline'); box.textContent = '';
  const firstDoc = S.docs.size ? [...S.docs.entries()][0] : null;
  let items = null;
  if (firstDoc) { try { items = await firstDoc[1].pdf.getOutline(); } catch { } }
  const has = !!(items && items.length);
  $('#sideTabs').hidden = !has;
  if (!has) { showSide('pages'); return; }
  const add = (list, depth, parent) => {
    for (const it of list) {
      const row = el('div', 'oi'); row.style.paddingLeft = 8 + depth * 14 + 'px';
      const tw = el('button', 'tw g'); tw.textContent = it.items && it.items.length ? '' : ''; row.append(tw);
      const b = el('button', 'ot'); b.textContent = it.title || '(untitled)'; b.title = it.title || ''; row.append(b);
      parent.append(row);
      b.addEventListener('click', () => { if (it.dest) goToDest(firstDoc[0], it.dest); else if (it.url) openUrl(it.url); });
      if (it.items && it.items.length) {
        const kids = el('div', 'okids'); kids.hidden = depth > 0; parent.append(kids);
        if (!kids.hidden) tw.textContent = '';
        tw.addEventListener('click', () => { kids.hidden = !kids.hidden; tw.textContent = kids.hidden ? '' : ''; });
        add(it.items, depth + 1, kids);
      }
    }
  };
  add(items, 0, box);
}
function showSide(which) {
  $('#thumbs').hidden = which !== 'pages'; $('#outline').hidden = which !== 'outline';
  $('#sideHead').hidden = which !== 'pages';
  document.querySelectorAll('#sideTabs button').forEach(b => b.classList.toggle('on', b.dataset.side === which));
}
document.querySelectorAll('#sideTabs button').forEach(b => b.addEventListener('click', () => showSide(b.dataset.side)));

/* ================= resume where you stopped reading ================= */
function getPositions() { try { return JSON.parse(localStorage.getItem('preview.pos') || '{}'); } catch { return {}; } }
let posT;
viewer.addEventListener('scroll', () => {
  clearTimeout(posT);
  posT = setTimeout(() => {
    if (!Cur.path || !S.pages.length || Cur.kind !== 'pdf') return;
    const all = getPositions(); delete all[Cur.path]; all[Cur.path] = S.cur;
    const keys = Object.keys(all); if (keys.length > 300) delete all[keys[0]];
    try { localStorage.setItem('preview.pos', JSON.stringify(all)); } catch { }
  }, 600);
});
function resumePosition() {
  if (!Cur.path) return;
  const i = getPositions()[Cur.path];
  if (i > 0 && i < S.pages.length) { scrollToPage(S.pages[i]); toast(`Continuing from page ${i + 1}`, 2200); }
}

/* ================= password-protected PDFs ================= */
function askPassword(name, wrong) {
  return new Promise(res => {
    const d = $('#pwDlg'), inp = $('#pwInput');
    $('#pwMsg').textContent = wrong ? 'That password is not correct. Try again.' : `"${name}" is protected. Enter its password to open it.`;
    $('#pwMsg').classList.toggle('bad', !!wrong);
    inp.value = '';
    const done = v => { d.close(); $('#pwOk').onclick = $('#pwCancel').onclick = null; d.oncancel = null; res(v); };
    $('#pwOk').onclick = () => done(inp.value);
    $('#pwCancel').onclick = () => done(null);
    d.oncancel = e => { e.preventDefault(); done(null); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } };
    busy(false); d.showModal(); inp.focus();
  });
}

/* ================= blank pages, images → PDF ================= */
async function insertBlankPage() {
  if (!S.pages.length) return;
  await Promise.all([ensurePdfLib(), ensurePdfJs()]);
  const at = S.sel.size ? Math.max(...S.pages.map((p, i) => S.sel.has(p.key) ? i : -1)) : S.cur;
  const ref = S.pages[at]; const v = vp(ref, 1);
  const d = await PDFLib.PDFDocument.create(); d.addPage([v.width, v.height]);
  await addPdfPages(await d.save(), 'Blank page', at + 1);
  toast('Blank page added');
}
async function imagesToPdf(files) {
  await ensurePdfLib();
  const d = await PDFLib.PDFDocument.create();
  for (const f of files) {
    const url = await useImageFile(f), b = dataUrlBytes(url);
    const img = url.startsWith('data:image/png') ? await d.embedPng(b) : await d.embedJpg(b);
    const k = 842 / Math.max(img.width, img.height);   // longest side = A4 height
    const pg = d.addPage([img.width * k, img.height * k]);
    pg.drawImage(img, { x: 0, y: 0, width: img.width * k, height: img.height * k });
  }
  return await d.save();
}
// Adds all pages of a PDF (given as bytes) into the open document at position `at`.
async function addPdfPages(bytes, name, at) {
  await ensurePdfJs();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), worker: pdfWorker }).promise;
  const docId = nid();
  S.docs.set(docId, { name, bytes: new Uint8Array(bytes), path: null, pdf });
  const fresh = [];
  for (let i = 0; i < pdf.numPages; i++) { pageInfo.set(docId + ':' + i, await pdf.getPage(i + 1)); fresh.push({ key: nid(), docId, idx: i, extra: 0, annots: [] }); }
  pushUndo();
  S.pages.splice(at, 0, ...fresh);
  rebuild(true);
}
async function openImages(files, path) {
  busy('Creating PDF…');
  try {
    const bytes = await imagesToPdf(files);
    const base = files[0].name.replace(/\.[^.]+$/, '');
    await loadFiles([new File([bytes], base + '.pdf', { type: 'application/pdf' })], false);
    Cur.path = path; dirty = true; setEditing(true); updateUI();
    toast(files.length > 1 ? `${files.length} images combined into a PDF – Save to keep it` : 'Image turned into a PDF – Save to keep it', 3500);
  } finally { busy(false); }
}
