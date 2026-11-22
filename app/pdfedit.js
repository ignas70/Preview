'use strict';
/* Preview – screen side of quick stamps and editing the existing text of a PDF (logic in pdfedit-core.js). */

/* ================= quick stamps ================= */
// Segoe Fluent icon codes for the stamp menu; combined stamps share one icon
const STAMP_ICONS = { "today's date": '', 'your name': '', 'your initials': '' };
function stampItems() {
  const items = stampTexts(Profile.get(), todayStr()).map(s => ({ icon: STAMP_ICONS[s.hint] || '', label: s.text, hint: s.hint, run: () => startStamp(s.text) }));
  items.push('-', { icon: '', label: Profile.get().name ? 'Change my name…' : 'Add my name and initials…', run: () => askProfile(true) });
  return items;
}
function openStampMenu() {
  const b = document.querySelector('#tools [data-tool="stamp"]');
  if (!Profile.get().name && !Profile.get().asked) { askProfile(true); return; }
  showMenu(b, stampItems(), { align: 'left' });
}
function askProfile(thenMenu) {
  const d = $('#profileDlg'), pr = Profile.get();
  $('#pfName').value = pr.name || ''; $('#pfIni').value = pr.initials || ''; $('#pfIni').placeholder = initialsOf(pr.name) || 'e.g. J. D.';
  d.showModal(); $('#pfName').focus();
  d.onclose = () => {
    if (d.returnValue !== 'ok') { Profile.set({ ...pr, asked: true }); }
    else Profile.set({ name: $('#pfName').value.trim(), initials: $('#pfIni').value.trim(), asked: true });
    d.returnValue = '';
    if (thenMenu) showMenu(document.querySelector('#tools [data-tool="stamp"]'), stampItems(), { align: 'left' });
  };
}
$('#pfName').addEventListener('input', e => { $('#pfIni').placeholder = initialsOf(e.target.value) || 'e.g. J. D.'; });
$('#pfOk').addEventListener('click', () => $('#profileDlg').close('ok'));
$('#pfCancel').addEventListener('click', () => $('#profileDlg').close());
$('#profileDlg').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#profileDlg').close('ok'); } });

const stampGhost = el('div', 'stampGhost'); document.body.append(stampGhost);
function startStamp(text) {
  S.stampText = text;
  setTool('stamp', true);
  toast('Click on the page to place it · Esc to cancel');
}
viewer.addEventListener('pointermove', e => {
  if (S.tool !== 'stamp' || !S.stampText) { stampGhost.style.display = 'none'; return; }
  stampGhost.textContent = S.stampText; stampGhost.style.display = 'block';
  stampGhost.style.fontSize = S.fontSize * S.zoom + 'px'; stampGhost.style.color = S.color;
  stampGhost.style.left = e.clientX + 'px'; stampGhost.style.top = e.clientY - S.fontSize * S.zoom * 0.6 + 'px';
});
viewer.addEventListener('pointerleave', () => { stampGhost.style.display = 'none'; });
function placeStamp(p, pt) {
  if (!S.stampText) { openStampMenu(); return; }
  pushUndo();
  const a = { id: nid(), type: 'text', x: pt.x, y: pt.y - S.fontSize * 0.6, text: S.stampText, size: S.fontSize, color: S.color, rot: 0 };
  p.annots.push(a); S.stampText = null; stampGhost.style.display = 'none';
  setTool('select'); S.annSel = { p, a }; renderAnnots(p);
}

/* ================= editing existing text ================= */
const hoverBox = el('div', 'editHover');
async function editHover(e, p) {
  if (S.tool !== 'edittext' || rotOf(p) !== 0) { hoverBox.remove(); return; }
  const lines = await textLines(p), l = lineAt(lines, toPage(e, p));
  if (!l || p.annots.some(a => a.type === 'edit' && a.src === l.x + ':' + l.base)) { hoverBox.remove(); return; }
  const z = S.zoom;
  Object.assign(hoverBox.style, { left: (l.x - 2) * z + 'px', top: l.top * z + 'px', width: (l.w + 4) * z + 'px', height: l.h * z + 'px' });
  if (hoverBox.parentNode !== p.el) p.el.append(hoverBox);
}
// background and text colour sampled from the rendered page
function sampleColors(p, l) {
  const c = p.el.querySelector('canvas'); if (!c || !c.width) return { bg: '#ffffff', fg: '#000000' };
  const k = c.width / vp(p, 1).width, ctx = c.getContext('2d', { willReadFrequently: true });
  const x0 = Math.max(0, Math.floor((l.x - 3) * k)), y0 = Math.max(0, Math.floor(l.top * k)), w = Math.min(c.width - x0, Math.ceil((l.w + 6) * k)), h = Math.min(c.height - y0, Math.ceil(l.h * k));
  if (w <= 0 || h <= 0) return { bg: '#ffffff', fg: '#000000' };
  const d = ctx.getImageData(x0, y0, w, h).data, inv = Night.on ? v => 255 - v : v => v;
  let painted = false; for (let i = 3; i < d.length && !painted; i += 4) painted = d[i] > 0;
  if (!painted) return { bg: '#ffffff', fg: '#000000' };   // the page is not drawn yet
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) { const key = (inv(d[i]) >> 3) << 10 | (inv(d[i + 1]) >> 3) << 5 | (inv(d[i + 2]) >> 3); counts.set(key, (counts.get(key) || 0) + 1); }
  let bgKey = 0, best = -1; for (const [key, n] of counts) if (n > best) { best = n; bgKey = key; }
  const unpack = key => [(key >> 10 & 31) * 8 + 4, (key >> 5 & 31) * 8 + 4, (key & 31) * 8 + 4];
  const bg = unpack(bgKey);
  let fg = [0, 0, 0], far = -1;
  for (const [key, n] of counts) { if (n < 3) continue; const q = unpack(key), dist = Math.abs(q[0] - bg[0]) + Math.abs(q[1] - bg[1]) + Math.abs(q[2] - bg[2]); if (dist > far) { far = dist; fg = q; } }
  const hex = q => '#' + q.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('');
  const snapW = q => q.every(v => v > 240) ? [255, 255, 255] : q;
  const snapK = q => q.every(v => v < 40) ? [0, 0, 0] : q;
  return { bg: hex(snapW(bg)), fg: hex(snapK(fg)) };
}
async function editTextAt(e, p) {
  if (rotOf(p) !== 0) { toast('Text can be edited on pages that are not rotated'); return; }
  const pt = toPage(e, p), lines = await textLines(p), l = lineAt(lines, pt);
  if (!l) { toast('Click on a line of text to change it'); return; }
  const src = l.x + ':' + l.base;
  const old = p.annots.find(a => a.type === 'edit' && a.src === src);
  if (old) { startEdit(p, old); return; }
  hoverBox.remove(); pushUndo();
  const { bg, fg } = sampleColors(p, l);
  const a = { id: nid(), type: 'edit', src, x: l.x - 1, y: l.top, w: l.w + 2, h: l.h, base: l.base - l.top, orig: l.str, text: l.str,
    size: +l.size.toFixed(2), color: fg, bg, fam: l.fam, bold: l.bold, italic: l.italic, rot: 0 };
  p.annots.push(a); renderAnnots(p); startEdit(p, a, true, true);
}
const FAM_CSS = { sans: 'Arial, "Helvetica Neue", sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
function editEl(p, a, isSel) {
  const z = S.zoom, e = el('div', 'annot edit' + (isSel ? ' sel' : ''));
  e.dataset.id = a.id; e.style.left = a.x * z + 'px'; e.style.top = a.y * z + 'px';
  e.style.minWidth = a.w * z + 'px'; e.style.height = a.h * z + 'px'; e.style.background = a.bg;
  if (a.rot) e.style.transform = `rotate(${a.rot}deg)`;   // the page was rotated after editing
  const c = el('div', 'content'); c.textContent = a.text;
  Object.assign(c.style, { fontSize: a.size * z + 'px', color: a.color, fontFamily: FAM_CSS[a.fam], fontWeight: a.bold ? '700' : '400', fontStyle: a.italic ? 'italic' : 'normal',
    lineHeight: a.size * z + 'px', paddingTop: Math.max(0, (a.base - a.size * 0.845) * z) + 'px', paddingLeft: z + 'px', paddingRight: z + 'px' });
  e.append(c);
  const del = el('button', 'del g'); del.textContent = ''; del.title = 'Restore the original text';
  del.addEventListener('pointerdown', ev => { ev.stopPropagation(); ev.preventDefault(); removeAnnot(p, a); });
  e.append(del);
  e.addEventListener('pointerdown', ev => annotDown(ev, p, a, e));
  return e;
}
