'use strict';
/* Preview – signature dialog, toolbar wiring, keyboard shortcuts, drag and drop. */

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
