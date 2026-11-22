'use strict';
/* Preview – PDF editing: pointer interactions, tools, page operations, thumbnails, zoom, undo. */

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
