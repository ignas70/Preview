'use strict';
/* Preview – PDF reading and extra editing features:
   selectable text, search, links, contents (outline), resume position, password-protected files,
   form filling, blank pages, images → PDF, compression, small menus and action toasts. */

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

/* ================= compression ================= */
// Re-encodes large JPEG pictures inside the PDF (max 2000 px, quality 72). Text and vector content are untouched.
async function compressDoc(out) {
  const { PDFName, PDFRawStream, PDFNumber, PDFArray } = PDFLib;
  const N = s => PDFName.of(s);
  let before = 0, after = 0, count = 0;
  for (const [ref, obj] of out.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(N('Subtype')) !== N('Image')) continue;
    let filter = dict.get(N('Filter'));
    if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.get(0) : null;
    if (filter !== N('DCTDecode') || dict.get(N('Decode'))) continue;
    let cs = dict.get(N('ColorSpace'));
    if (cs instanceof PDFArray && cs.get(0) === N('ICCBased')) {
      const icc = out.context.lookup(cs.get(1)); const n = icc && icc.dict && icc.dict.get(N('N'));
      cs = n && n.asNumber && n.asNumber() === 3 ? N('DeviceRGB') : null;
    }
    if (cs !== N('DeviceRGB') && cs !== N('DeviceGray')) continue;
    const bytes = obj.contents;
    if (bytes.length < 40000) continue;
    let bmp; try { bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })); } catch { continue; }
    const hasMask = !!dict.get(N('SMask')) || !!dict.get(N('Mask'));
    const k = hasMask ? 1 : Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const W = Math.max(1, Math.round(bmp.width * k)), H = Math.max(1, Math.round(bmp.height * k));
    const c = new OffscreenCanvas(W, H); const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(bmp, 0, 0, W, H); bmp.close && bmp.close();
    const nb = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.72 })).arrayBuffer());
    if (nb.length > bytes.length * 0.9) continue;
    const nd = dict.clone(out.context);
    nd.set(N('Width'), PDFNumber.of(W)); nd.set(N('Height'), PDFNumber.of(H));
    nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('BitsPerComponent'), PDFNumber.of(8));
    nd.set(N('Filter'), N('DCTDecode')); nd.delete(N('DecodeParms'));
    out.context.assign(ref, PDFRawStream.of(nd, nb));
    before += bytes.length; after += nb.length; count++;
  }
  return { count, saved: before - after };
}

/* ================= any document → PDF (uses the browser engine's PDF printer) ================= */
async function saveDocAsPdf() {
  if (!host) { window.print(); return; }
  const ext = extOf(Cur.name || '');
  let landscape = Cur.kind === 'pptx' || ext === 'key' || ext === 'ppt' || ext === 'pps' || ext === 'odp';
  const restore = [];
  const fitTo = (node, width) => { if (node && node.offsetWidth > width) { restore.push([node, node.style.zoom]); node.style.zoom = width / node.offsetWidth; } };
  if (Cur.kind === 'sheet' || Cur.kind === 'numbers') {
    const t = $('table.grid'); if (t) { landscape = t.offsetWidth > 760; fitTo(t, landscape ? 1070 : 740); }
  } else if (Cur.kind === 'pptx') fitTo($('.pptx-host'), 1070);
  document.body.dataset.print = Cur.kind || '';
  const name = (Cur.name || 'document').replace(/\.[^.]+$/, '') + '.pdf';
  busy('Creating PDF…');
  let r;
  try { r = await hostCall('printToPdf', { name, dir: Cur.path ? dirOf(Cur.path) : '', landscape }); }
  finally { busy(false); delete document.body.dataset.print; for (const [n, z] of restore) n.style.zoom = z; }
  if (r.error) toast('Could not create the PDF: ' + r.error, 5000);
  else if (r.path) toastAction('Saved ' + r.path.split(/[\\/]/).pop(), 'Open', () => hostCall('newWindow', { path: r.path }));
}
$('#docPdf').addEventListener('click', saveDocAsPdf);

/* ================= older formats: .doc, .ppt, .rtf, .odt, .odp ================= */
async function renderLegacy(f, inner, ext) {
  await loadLib('lib/xlsx.full.min.js'); await loadLib('lib/jszip.min.js'); await loadLib('lib/legacy.js');
  const res = await Legacy.read(await f.arrayBuffer(), ext);
  const label = { doc: 'Word 97–2003 document', dot: 'Word 97–2003 template', ppt: 'PowerPoint 97–2003 presentation', pps: 'PowerPoint 97–2003 show', rtf: 'RTF document', odt: 'OpenDocument text', odp: 'OpenDocument presentation' }[ext] || 'Document';
  inner.className = '';
  const note = el('div', 'iwNote'); note.textContent = `Simplified view of this ${label}: ${res.type === 'slides' ? 'the text of each slide' : 'its text'}${ext === 'rtf' || ext === 'doc' ? '' : ' and pictures'}. Formatting and layout are not shown.`;
  inner.append(note);
  if (res.type === 'doc') {
    const doc = el('article', 'iwDoc');
    for (const b of res.blocks) {
      if (b.t === 'img') { const im = el('img'); im.src = b.url; doc.append(im); }
      else if (b.t === 'hr') doc.append(el('hr'));
      else { const e = el(/^h[123]$/.test(b.t) ? b.t : 'p'); e.textContent = b.text; doc.append(e); }
    }
    if (!res.blocks.length) { const p = el('p'); p.textContent = '(No text found in this document.)'; doc.append(p); }
    inner.append(doc);
  } else {
    const box = el('div', 'kSlides');
    res.slides.forEach((s, i) => {
      const card = el('section', 'kSlide');
      const num = el('div', 'num'); num.textContent = `Slide ${i + 1} of ${res.slides.length}`; card.append(num);
      const txt = el('div', 'txt');
      for (const grp of s.blocks) { const g = el('div', 'grp'); for (const b of grp) { const e = el(/^h[123]$/.test(b.t) ? b.t : 'p'); e.textContent = b.text; g.append(e); } txt.append(g); }
      card.append(txt);
      for (const u of s.images) { const im = el('img'); im.src = u; im.style.marginTop = '10px'; card.append(im); }
      box.append(card);
    });
    if (res.images && res.images.length) {
      const card = el('section', 'kSlide'); const num = el('div', 'num'); num.textContent = 'Pictures in this presentation'; card.append(num);
      const grid = el('div', 'picGrid'); for (const u of res.images) { const im = el('img'); im.src = u; grid.append(im); } card.append(grid); box.append(card);
    }
    inner.append(box);
  }
}

/* ================= real PDF comments (annotations with appearance streams) ================= */
// Returns true when `a` was written as an annotation; false means "draw it into the page instead".
function writeAnnot(out, pg, a, conv, R, font) {
  const L = PDFLib, ctx = out.context, N = n => L.PDFName.of(n);
  const rgbOf = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const bounds = pts => { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const add = (subtype, rect, extra, ops, resources) => {
    const ap = ctx.register(ctx.formXObject(ops, { BBox: rect, Resources: resources || {} }));
    const dict = ctx.obj({
      Type: 'Annot', Subtype: subtype, Rect: rect, F: 4,
      NM: L.PDFString.of('preview-' + a.id + '-' + Date.now().toString(36)),
      M: L.PDFString.fromDate(new Date()), T: L.PDFHexString.fromText('Preview'),
      AP: { N: ap }, ...extra,
    });
    pg.node.addAnnot(ctx.register(dict));
    return true;
  };
  if (a.type === 'rect' && a.kind === 'highlight') {
    const [x1, y1, x2, y2] = bounds([conv(a.x, a.y), conv(a.x + a.w, a.y + a.h)]);
    const [r, g, b] = rgbOf(a.color);
    return add('Highlight', [x1, y1, x2, y2], { C: [r, g, b], CA: a.opacity, QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1] },
      [L.pushGraphicsState(), L.setGraphicsState('GS0'), L.setFillingRgbColor(r, g, b), L.rectangle(x1, y1, x2 - x1, y2 - y1), L.fill(), L.popGraphicsState()],
      { ExtGState: { GS0: { Type: 'ExtGState', ca: a.opacity, CA: a.opacity, BM: 'Multiply' } } });
  }
  if (a.type === 'ink' && a.points.length > 1) {
    const pts = a.points.map(([x, y]) => conv(x, y)), [r, g, b] = rgbOf(a.color), w = a.width;
    const [x1, y1, x2, y2] = bounds(pts), rect = [x1 - w, y1 - w, x2 + w, y2 + w];
    const ops = [L.pushGraphicsState(), L.setStrokingRgbColor(r, g, b), L.setLineWidth(w), L.setLineCap(L.LineCapStyle.Round), L.setLineJoin(L.LineJoinStyle.Round), L.moveTo(pts[0][0], pts[0][1])];
    for (let i = 1; i < pts.length; i++) ops.push(L.lineTo(pts[i][0], pts[i][1]));
    ops.push(L.stroke(), L.popGraphicsState());
    return add('Ink', rect, { C: [r, g, b], BS: { W: w, S: 'S' }, InkList: [pts.flat()] }, ops);
  }
  if (a.type === 'text' && a.text.trim() && font) {
    const lines = a.text.replace(/\t/g, '    ').split('\n'), size = a.size, rot = a.rot || 0;
    const w = Math.max(...lines.map(l => font.widthOfTextAtSize(l, size))) + 2, h = lines.length * size * 1.2;
    const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([u, v]) => { const [dx, dy] = rotv(u, v, rot); return conv(a.x + dx, a.y + dy); });
    const rect = bounds(corners), [r, g, b] = rgbOf(a.color);
    const th = (R - rot) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const ops = [L.pushGraphicsState(), L.beginText(), L.setFontAndSize('F1', size), L.setFillingRgbColor(r, g, b)];
    lines.forEach((line, i) => {
      if (!line) return;
      const [lx, ly] = rotv(0, (baseRatio + i * 1.2) * size, rot), [x, y] = conv(a.x + lx, a.y + ly);
      ops.push(L.setTextMatrix(c, s, -s, c, x, y), L.showText(font.encodeText(line)));
    });
    ops.push(L.endText(), L.popGraphicsState());
    return add('FreeText', rect, {
      Contents: L.PDFHexString.fromText(a.text), DA: L.PDFString.of(`/Helv ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`),
      BS: { W: 0 }, Rotate: ((R - rot) % 360 + 360) % 360,
    }, ops, { Font: { F1: font.ref } });
  }
  if (a.type === 'note') {
    const [x, y] = conv(a.x, a.y + 20), s = 20, rect = [x, y, x + s, y + s], [r, g, b] = rgbOf(a.color || '#ffd400');
    const ops = [L.pushGraphicsState(), L.setFillingRgbColor(r, g, b), L.setStrokingRgbColor(r * 0.6, g * 0.6, b * 0.3), L.setLineWidth(0.8),
      L.rectangle(x + 1, y + 4, s - 2, s - 5), L.fillAndStroke(),
      L.moveTo(x + 5, y + 4.5), L.lineTo(x + 5, y + 0.5), L.lineTo(x + 9, y + 4.5), L.fillAndStroke(),
      L.setStrokingRgbColor(0.35, 0.3, 0.1), L.moveTo(x + 4, y + 14), L.lineTo(x + s - 4, y + 14), L.moveTo(x + 4, y + 10.5), L.lineTo(x + s - 4, y + 10.5), L.moveTo(x + 4, y + 7), L.lineTo(x + s - 8, y + 7), L.stroke(),
      L.popGraphicsState()];
    return add('Text', rect, { Contents: L.PDFHexString.fromText(a.text || ''), Name: 'Comment', C: [r, g, b], Open: false }, ops);
  }
  return false;
}
// Flattened copy: a note becomes a small yellow box with its text.
function drawNoteFlat(pg, a, conv, font) {
  const [x, y] = conv(a.x, a.y + 20);
  pg.drawRectangle({ x, y, width: 18, height: 18, color: PDFLib.rgb(1, 0.83, 0), borderColor: PDFLib.rgb(0.6, 0.5, 0), borderWidth: 0.8 });
  if (font && (a.text || '').trim()) a.text.split('\n').forEach((line, i) => line && pg.drawText(line, { x: x + 22, y: y + 12 - i * 11, size: 9, font, color: PDFLib.rgb(0.2, 0.2, 0.2) }));
}

/* ---- sticky notes: a small icon on the page; the text appears in a card on hover ---- */
const NotePop = { id: null, edit: false, hideT: 0 };
function notePopEl() {
  let pop = $('#notePop');
  if (!pop) {
    pop = el('div'); pop.id = 'notePop'; pop.hidden = true; document.body.append(pop);
    pop.addEventListener('pointerenter', () => clearTimeout(NotePop.hideT));
    pop.addEventListener('pointerleave', () => { if (!NotePop.edit) hideNotePop(); });
    pop.addEventListener('pointerdown', ev => ev.stopPropagation());
  }
  return pop;
}
// Shows the card next to `anchor`. read-only: text; edit: a text box bound to the note.
function showNotePop(anchor, text, opts = {}) {
  clearTimeout(NotePop.hideT);
  const pop = notePopEl();
  pop.className = opts.edit ? 'edit' : '';
  pop.textContent = '';
  if (opts.edit) {
    const ta = el('textarea'); ta.value = text || ''; ta.placeholder = 'Write a note…';
    ta.addEventListener('input', () => { opts.onInput(ta.value); });
    ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); opts.onClose(); } ev.stopPropagation(); });
    pop.append(ta);
    const hint = el('div', 'npHint'); hint.textContent = 'Click outside the note to close · Esc'; pop.append(hint);
    setTimeout(() => ta.focus());
  } else {
    if (opts.title) { const h = el('div', 'npTitle'); h.textContent = opts.title; pop.append(h); }
    const t = el('div', 'npText'); t.textContent = text || 'Empty note'; if (!text) t.classList.add('empty'); pop.append(t);
  }
  NotePop.id = opts.id || null; NotePop.edit = !!opts.edit;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = r.right + 8, y = r.top - 4;
  if (x + pw > innerWidth - 8) x = r.left - pw - 8;
  if (x < 8) x = Math.max(8, Math.min(innerWidth - pw - 8, r.left));
  if (y + ph > innerHeight - 8) y = innerHeight - ph - 8;
  pop.style.left = x + 'px'; pop.style.top = Math.max(8, y) + 'px';
}
function hideNotePop(delay) {
  clearTimeout(NotePop.hideT);
  const go = () => { const pop = $('#notePop'); if (pop) pop.hidden = true; NotePop.id = null; NotePop.edit = false; };
  if (delay) NotePop.hideT = setTimeout(go, delay); else go();
}
viewer.addEventListener('scroll', () => { if (!NotePop.edit) hideNotePop(); });

function noteEl(p, a, isSel) {
  const z = S.zoom, e = el('div', 'annot note' + (isSel ? ' sel' : ''));
  e.dataset.id = a.id; e.style.left = a.x * z + 'px'; e.style.top = a.y * z + 'px';
  e.style.width = e.style.height = 18 * z + 'px';
  const icon = el('div', 'content g'); icon.textContent = ''; icon.style.fontSize = 15 * z + 'px'; icon.style.color = a.color || '#f2b600'; e.append(icon);
  const editing = () => document.body.classList.contains('editing');
  // close the editor: an empty note is removed
  const closeEdit = () => {
    hideNotePop();
    if (!(a.text || '').trim()) { const i = p.annots.indexOf(a); if (i >= 0) p.annots.splice(i, 1); }
    if (S.annSel && S.annSel.a === a) S.annSel = null;
    renderAnnots(p);
  };
  if (isSel && editing()) {
    setTimeout(() => {
      if (!e.isConnected) return;
      showNotePop(e, a.text, { edit: true, id: a.id, onInput: v => { a.text = v; if (!dirty) { dirty = true; updateUI(); } }, onClose: closeEdit });
    });
  }
  e.addEventListener('pointerenter', () => { if (!(NotePop.edit && NotePop.id === a.id)) showNotePop(e, a.text, { id: a.id }); });
  e.addEventListener('pointerleave', () => { if (!NotePop.edit) hideNotePop(250); });
  if (editing()) {
    const del = el('button', 'del g'); del.textContent = ''; del.title = 'Delete note';
    del.addEventListener('pointerdown', ev => { ev.stopPropagation(); ev.preventDefault(); hideNotePop(); removeAnnot(p, a); });
    e.append(del);
  }
  e.addEventListener('pointerdown', ev => {
    if (!editing()) return;
    if (!isSel) { ev.stopPropagation(); ev.preventDefault(); hideNotePop(); selectAnnot(p, a); renderAnnots(p); return; }
    annotDown(ev, p, a, e);
  });
  return e;
}
// clicking anywhere else closes an open note editor
document.addEventListener('pointerdown', ev => {
  if (!NotePop.edit) return;
  const pop = $('#notePop'); if (pop && pop.contains(ev.target)) return;
  if (ev.target.closest && ev.target.closest('.annot.note.sel')) return;
  const sel = S.annSel; hideNotePop();
  if (sel && sel.a.type === 'note') {
    if (!(sel.a.text || '').trim()) { const i = sel.p.annots.indexOf(sel.a); if (i >= 0) sel.p.annots.splice(i, 1); }
    S.annSel = null; renderAnnots(sel.p);
  }
}, true);
function addNote(p, pt) {
  pushUndo();
  const a = { id: nid(), type: 'note', x: pt.x - 9, y: pt.y - 9, text: '', color: '#f2b600' };
  p.annots.push(a); S.annSel = { p, a }; setTool('select'); renderAnnots(p);
}

/* ================= printing a PDF (with everything added in Preview) ================= */
async function printPdf() {
  if (!S.pages.length) return;
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  busy('Preparing to print…');
  const box = $('#printBox'), urls = [];
  try {
    const res = await buildPdf(S.pages);
    const doc = await pdfjsLib.getDocument({ data: res.bytes.slice(), worker: pdfWorker }).promise;
    box.textContent = '';
    for (let i = 1; i <= doc.numPages; i++) {
      busy(`Preparing to print… page ${i} of ${doc.numPages}`);
      const pg = await doc.getPage(i), v = pg.getViewport({ scale: 150 / 72 });   // 150 dpi
      const c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      const url = URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))); urls.push(url);
      const im = el('img', v.width > v.height ? 'land' : 'port'); im.src = url; box.append(im);
    }
    await Promise.all([...box.querySelectorAll('img')].map(im => im.decode().catch(() => { })));
    doc.destroy();
  } catch (e) { busy(false); toast('Could not prepare the document for printing: ' + e.message, 5000); return; }
  busy(false);
  document.body.classList.add('printingPdf');
  window.print();
  document.body.classList.remove('printingPdf');
  box.textContent = ''; urls.forEach(u => URL.revokeObjectURL(u));
}

/* ================= presentation mode (F5) ================= */
const Show = { on: false, i: 0, count: 0, render: null };
async function present() {
  const mode = document.body.dataset.mode;
  let nodes = null;
  if (mode === 'pdf') {
    if (!S.pages.length) return;
    Show.count = S.pages.length; Show.i = S.cur || 0;
    Show.render = async i => {
      const p = S.pages[i], pg = await realPage(p);
      const v1 = vp(p, 1), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(innerWidth / v1.width, innerHeight / v1.height);
      const v = vp(p, scale * dpr), c = document.createElement('canvas');
      c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      c.style.width = v1.width * scale + 'px'; c.style.height = v1.height * scale + 'px';
      await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: v }).promise;
      return c;
    };
  } else if (mode === 'doc') {
    nodes = [...document.querySelectorAll('.pptx-preview-slide-wrapper')];
    if (!nodes.length) nodes = [...document.querySelectorAll('.kSlide img')];
    if (!nodes.length) nodes = [...document.querySelectorAll('.kSlide')];
    if (!nodes.length) nodes = [...document.querySelectorAll('.docx-wrapper>section.docx')];
    if (!nodes.length) { toast('Nothing to present in this file'); return; }
    Show.count = nodes.length; Show.i = 0;
    Show.render = async i => {
      const src = nodes[i], w = src.offsetWidth || src.naturalWidth, h = src.offsetHeight || src.naturalHeight;
      const k = Math.min(innerWidth / w, innerHeight / h);
      const holder = el('div', 'showSlide'); holder.style.width = w * k + 'px'; holder.style.height = h * k + 'px';
      const clone = src.cloneNode(true); clone.style.transform = `scale(${k})`; clone.style.transformOrigin = '0 0'; clone.style.margin = '0';
      clone.style.width = w + 'px'; clone.style.height = h + 'px';
      holder.append(clone); return holder;
    };
  } else return;
  const ov = $('#present'); ov.hidden = false; Show.on = true;
  try { await ov.requestFullscreen(); } catch { }
  await showSlide(Show.i);
}
async function showSlide(i) {
  Show.i = Math.max(0, Math.min(Show.count - 1, i));
  const ov = $('#present'), node = await Show.render(Show.i);
  ov.querySelector('.showStage').replaceChildren(node);
  ov.querySelector('.showCount').textContent = `${Show.i + 1} / ${Show.count}`;
  if (document.body.dataset.mode === 'pdf' && S.pages[Show.i]) scrollToPage(S.pages[Show.i]);
}
function endShow() {
  if (!Show.on) return;
  Show.on = false; $('#present').hidden = true; $('#present .showStage').textContent = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) endShow(); else if (Show.on) setTimeout(() => showSlide(Show.i), 60); });
document.addEventListener('keydown', e => {
  if (!Show.on) return;
  const k = e.key;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) showSlide(Show.i + 1);
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) showSlide(Show.i - 1);
  else if (k === 'Home') showSlide(0);
  else if (k === 'End') showSlide(Show.count - 1);
  else if (k === 'Escape') endShow();
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
$('#present').addEventListener('click', e => { if (e.target.closest('.showExit')) return endShow(); showSlide(Show.i + 1); });
$('#present').addEventListener('contextmenu', e => { e.preventDefault(); showSlide(Show.i - 1); });
$('#btnPresent').addEventListener('click', present);
$('#docPresent').addEventListener('click', present);

/* ================= settings (kept by the Windows host) ================= */
async function loadSettings() {
  if (!host) return;
  const r = await hostCall('getSettings');
  $('#setTabs').checked = !!r.tabs; $('#setStartup').checked = !!r.startup; $('#setUpdates').checked = r.updates !== false;
  showUpdateState(r);
}
// ---- updates (the host checks the GitHub releases and runs the new setup) ----
let updVersion = null;
function showUpdateState(r) {
  updVersion = r.latest || null;
  $('#updInfo').textContent = `Version ${r.version || '?'}` + (r.latest ? ` · version ${r.latest} is available` : r.checked ? ' · up to date' : '') + (r.error ? ` · could not check (${r.error})` : '');
  $('#updBtn').textContent = r.latest ? 'Update now' : 'Check now';
  $('#updBtn').classList.toggle('primary', !!r.latest);
}
async function installUpdate() {
  if (dirty && !confirm('Unsaved PDF changes will be lost. Update now?')) return;
  busy('Downloading the update…');
  const r = await hostCall('installUpdate');
  busy(false);
  if (r.error) toast('Could not update: ' + r.error, 5000); else busy('Installing the update…');
}
$('#updBtn').addEventListener('click', async () => {
  if (updVersion) { installUpdate(); return; }
  $('#updBtn').disabled = true; $('#updInfo').textContent = 'Checking…';
  const r = await hostCall('checkUpdate'); $('#updBtn').disabled = false;
  showUpdateState({ ...r, checked: !r.error });
});
if (host) host.addEventListener('message', e => {
  const m = e.data; if (!m || m.cmd !== 'updateAvailable') return;
  updVersion = m.version; loadSettings();
  toastAction(`Preview ${m.version} is available`, 'Update', installUpdate, 12000);
});
for (const [id, name] of [['#setTabs', 'tabs'], ['#setStartup', 'startup'], ['#setUpdates', 'updates']]) {
  $(id).addEventListener('change', async e => {
    const r = await hostCall('setSetting', { name, value: e.target.checked });
    if (r.error) { toast('Could not change the setting: ' + r.error, 4000); e.target.checked = !e.target.checked; return; }
    if (name === 'startup') toast(e.target.checked ? 'Preview will start with Windows' : 'Preview will no longer start with Windows', 2500);
  });
}
loadSettings();

/* ================= small UI helpers: popup menu, toast with action ================= */
function showMenu(anchor, items, opts = {}) {
  closeMenu();
  const m = el('div', 'menu'); m.id = 'popMenu';
  for (const it of items) {
    if (it === '-') { m.append(el('div', 'msep')); continue; }
    const b = el('button', 'mi'); if (it.disabled) b.disabled = true;
    const g = el('span', 'g'); g.textContent = it.icon || ''; b.append(g);
    const t = el('span', 'ml'); t.textContent = it.label;
    if (it.hint) { const h = el('small'); h.textContent = it.hint; t.append(h); b.title = it.hint; }
    b.append(t);
    if (it.key) { const k = el('span', 'mk'); k.textContent = it.key; b.append(k); }
    b.addEventListener('click', () => { closeMenu(); it.run(); });
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const left = opts.align === 'left' ? Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8))
    : Math.min(window.innerWidth - m.offsetWidth - 8, Math.max(8, r.right - m.offsetWidth));
  m.style.left = left + 'px'; m.style.top = r.bottom + 4 + 'px';
  setTimeout(() => document.addEventListener('pointerdown', menuAway, true));
}
function menuAway(e) { const m = $('#popMenu'); if (m && !m.contains(e.target)) closeMenu(); }
function closeMenu() { $('#popMenu')?.remove(); document.removeEventListener('pointerdown', menuAway, true); }
function toastAction(msg, label, fn, ms = 6000) {
  const t = $('#toast'); t.textContent = msg;
  const b = el('button', 'tact'); b.textContent = label; b.addEventListener('click', () => { t.classList.remove('show'); fn(); });
  t.append(b); t.classList.add('show', 'withAction');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show', 'withAction'), ms);
}

/* ================= shared toolbar pieces ================= */
// Open ▾ – recent files
document.querySelectorAll('.recentBtn').forEach(b => b.addEventListener('click', () => {
  const items = [{ icon: '', label: 'Open a file…', key: 'Ctrl+O', run: openDialog }];
  if (host) items.push({ icon: '', label: 'New tab', key: 'Ctrl+T', run: () => hostCall('newWindow', { path: null }) });
  const rec = host ? getRecent().filter(p => p !== Cur.path).slice(0, 8) : [];
  if (rec.length) { items.push('-'); for (const p of rec) items.push({ icon: '', label: p.split(/[\\/]/).pop(), hint: dirOf(p), run: () => openPath(p) }); }
  showMenu(b.closest('.split'), items, { align: 'left' });
}));
// page panel
function toggleSidebar(force) {
  const hide = force != null ? !force : !document.body.classList.contains('noSide');
  document.body.classList.toggle('noSide', hide);
  $('#btnSidebar').classList.toggle('on', !hide);
  try { localStorage.setItem('preview.side', hide ? '0' : '1'); } catch { }
}
$('#btnSidebar').addEventListener('click', () => toggleSidebar());
try { toggleSidebar(localStorage.getItem('preview.side') !== '0'); } catch { toggleSidebar(true); }
// keyboard shortcuts (F1)
function openKeys() { const d = $('#keysDlg'); if (!d.open) d.showModal(); }
$('#keysClose').addEventListener('click', () => $('#keysDlg').close());
$('#keysDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
document.querySelectorAll('.keysBtn').forEach(b => b.addEventListener('click', openKeys));
$('#toSettings').addEventListener('click', () => $('#settingsWrap').scrollIntoView({ behavior: 'smooth', block: 'start' }));
// the same "more" items for every kind of file
const themeItem = () => ({ icon: '', label: 'Theme: ' + themeNames[Theme.mode], hint: 'click to change', run: () => setThemeMode({ auto: 'light', light: 'dark', dark: 'auto' }[Theme.mode]) });
const fileItems = () => [
  { icon: '', label: 'Open with another app…', disabled: !host || !Cur.path, run: () => hostCall('openWith', { path: Cur.path }) },
  { icon: '', label: 'Show in folder', disabled: !host || !Cur.path, run: () => hostCall('showInFolder', { path: Cur.path }) },
];
const appItems = () => [themeItem(), { icon: '', label: 'Keyboard shortcuts', key: 'F1', run: openKeys }];
$('#btnDocMore').addEventListener('click', e => {
  const slides = !$('#docPresent').hidden;
  showMenu(e.currentTarget, [
    ...(slides ? [{ icon: '', label: 'Present', key: 'F5', run: present }] : []),
    { icon: '', label: 'Print…', key: 'Ctrl+P', run: () => window.print() },
    { icon: '', label: 'Save as PDF…', run: saveDocAsPdf },
    '-', ...fileItems(), '-', ...appItems(),
  ]);
});

$('#btnPdfMore').addEventListener('click', e => showMenu(e.currentTarget, [
  { icon: '', label: 'Find…', key: 'Ctrl+F', run: openFind },
  { icon: '', label: 'Recognize text (OCR)', run: () => runOcr() },
  { icon: '', label: 'Print…', key: 'Ctrl+P', run: printPdf },
  { icon: '', label: 'Present', key: 'F5', run: present },
  '-',
  { icon: '', label: 'Save a copy…', key: 'Ctrl+S', run: () => save() },
  { icon: '', label: 'Save a compressed copy…', run: () => save(S.pages, '-compressed', { compress: true }) },
  { icon: '', label: 'Save a flattened copy…', run: () => save(S.pages, '-flattened', { flatten: true }) },
  '-',
  { icon: '', label: 'Insert blank page', run: () => { setEditing(true); insertBlankPage(); } },
  { icon: '', label: 'Add PDFs or images…', run: () => { setEditing(true); $('#fileAdd').click(); } },
  '-',
  ...fileItems(), '-',
  { icon: '', label: document.body.classList.contains('noSide') ? 'Show page panel' : 'Hide page panel', key: 'Ctrl+B', run: () => toggleSidebar() },
  ...appItems(),
]));
