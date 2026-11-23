'use strict';
/* Preview – file router and the viewers for Word, Excel, PowerPoint, Apple, Google and older formats. */

const Cur = { path: null, name: '', zoom: 1, kind: null };
const EXT = {
  pdf: 'pdf',
  docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx',
  xlsx: 'sheet', xlsm: 'sheet', xlsb: 'sheet', xls: 'sheet', xltx: 'sheet', ods: 'sheet', fods: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'numbers',
  pptx: 'pptx', ppsx: 'pptx', potx: 'pptx', pptm: 'pptx',
  pages: 'apple', key: 'apple',
  gdoc: 'google', gsheet: 'google', gslides: 'google', gform: 'google', gdraw: 'google',
  txt: 'text', md: 'markdown', markdown: 'markdown', log: 'text', json: 'text', xml: 'text', ini: 'text',
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
    else if (kind === 'esign') await renderContainer(f, inner);
    else if (kind === 'markdown') { await loadLib('markdown.js'); await loadLib('markdown-view.js'); renderMarkdown(await f.text(), inner, Cur.path ? dirOf(Cur.path) : ''); }
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
