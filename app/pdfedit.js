'use strict';
/* Preview – quick stamps (date, name, initials) and editing the existing text of a PDF. */

/* ================= quick stamps ================= */
const Profile = {
  get() { try { return JSON.parse(localStorage.getItem('preview.profile') || '{}'); } catch { return {}; } },
  set(p) { try { localStorage.setItem('preview.profile', JSON.stringify(p)); } catch { } },
};
const initialsOf = n => (n || '').trim().split(/[\s-]+/).filter(Boolean).map(w => w[0].toUpperCase() + '.').join(' ');
const todayStr = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
function stampItems() {
  const pr = Profile.get(), name = (pr.name || '').trim(), ini = pr.initials || initialsOf(name), date = todayStr();
  const pick = text => () => startStamp(text);
  const items = [{ icon: '', label: date, hint: "today's date", run: pick(date) }];
  if (name) items.push(
    { icon: '', label: name, hint: 'your name', run: pick(name) },
    { icon: '', label: ini, hint: 'your initials', run: pick(ini) },
    { icon: '', label: `${name}, ${date}`, hint: 'name and date', run: pick(`${name}, ${date}`) },
    { icon: '', label: `${ini} ${date}`, hint: 'initials and date', run: pick(`${ini} ${date}`) });
  items.push('-', { icon: '', label: name ? 'Change my name…' : 'Add my name and initials…', run: () => askProfile(true) });
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
// Click a line of the PDF's own text: it is covered with its background colour and retyped on top in a
// matching font, size and colour. On saving both are written into the page itself.
const lineCache = new Map();
// font family / weight from the embedded font's name (e.g. "ABCDEF+NimbusRomNo9L-Medi" → serif bold)
function fontStyle(pg, id, cssFam) {
  let name = '', bold = false, italic = false;
  try { if (pg.commonObjs.has(id)) { const f = pg.commonObjs.get(id); name = (f.name || '').replace(/^[A-Z]{6}\+/, ''); bold = !!(f.bold || f.black); italic = !!f.italic; } } catch { }
  const n = name.toLowerCase();
  bold = bold || /bold|black|heavy|semibold|demi|-medi\b|-med\b|\bbd\b|cmbx/.test(n);
  italic = italic || /italic|oblique|-ital\b|-it\b|cmti|-regu?i\b|-medii\b/.test(n);
  const fam = /courier|mono|consol|nimbusmon|cmtt|menlo|inconsolata/.test(n) ? 'mono'
    : /times|roman|nimbusrom|serif(?!.*sans)|georgia|garamond|cambria|palatino|minion|book|utopia|cmr|lmroman|charter|baskerville|didot|bodoni|caslon/.test(n) && !/sans/.test(n) ? 'serif'
    : n ? 'sans' : /mono/.test(cssFam || '') ? 'mono' : /serif/.test(cssFam || '') && !/sans/.test(cssFam || '') ? 'serif' : 'sans';
  return { fam, bold, italic, fontName: name };
}
async function textLines(p) {
  const key = p.docId + ':' + p.idx;
  if (lineCache.has(key)) return lineCache.get(key);
  const pg = await realPage(p), tc = await pg.getTextContent();
  await pg.getOperatorList();   // loads the page's fonts, so their names are known even before it is drawn
  const v1 = pg.getViewport({ scale: 1, rotation: 0 });
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() && !it.str.length) continue;
    const m = pdfjsLib.Util.transform(v1.transform, it.transform);
    if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) continue;          // only horizontal text
    const size = Math.hypot(m[2], m[3]); if (size < 2) continue;
    items.push({ str: it.str, x: m[4], base: m[5], w: it.width, size, ...fontStyle(pg, it.fontName, (tc.styles[it.fontName] || {}).fontFamily), font: it.fontName });
  }
  // join runs on the same baseline into lines
  items.sort((a, b) => Math.abs(a.base - b.base) < 0.5 ? a.x - b.x : a.base - b.base);
  const lines = [];
  for (const it of items) {
    const l = lines[lines.length - 1];
    const gap = l ? it.x - (l.x + l.w) : 0;
    if (l && Math.abs(l.base - it.base) < Math.max(0.5, l.size * 0.15) && Math.abs(l.size - it.size) < l.size * 0.2 && gap > -l.size * 0.3 && gap < l.size * 1.2) {
      l.str += (gap > l.size * 0.18 && !/\s$/.test(l.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
      l.w = it.x + it.w - l.x;
    } else if (it.str.trim()) lines.push({ ...it });
  }
  for (const l of lines) { l.str = l.str.replace(/\s+$/, ''); l.top = l.base - l.size * 0.9; l.h = l.size * 1.17; }
  lineCache.set(key, lines);
  return lines;
}
function lineAt(lines, pt) {
  return lines.find(l => pt.x >= l.x - 2 && pt.x <= l.x + l.w + 2 && pt.y >= l.top - 1 && pt.y <= l.top + l.h + 1);
}
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
// PDF output: cover + retyped text in the page content
const stdFontCache = new WeakMap();
const SYS_FONTS = { sans: ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'], serif: ['times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf'], mono: ['cour.ttf', 'courbd.ttf', 'couri.ttf', 'courbi.ttf'] };
const WIN_ANSI = /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;
async function editFont(out, a, fallback) {
  const SF = PDFLib.StandardFonts;
  const name = { sans: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'], serif: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'], mono: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] }[a.fam || 'sans'][(a.bold ? 1 : 0) + (a.italic ? 2 : 0)];
  let m = stdFontCache.get(out); if (!m) stdFontCache.set(out, m = new Map());
  if (!m.has(name)) m.set(name, await out.embedFont(SF[name]));
  // Windows' own Arial / Times New Roman / Courier New: same look as on screen and every letter (ą, č, ę…)
  const file = SYS_FONTS[a.fam || 'sans'][(a.bold ? 1 : 0) + (a.italic ? 2 : 0)];
  if (host && !m.has(file)) {
    let f = null;
    try { const r = await fetch(fileUrl('C:\\Windows\\Fonts\\' + file)); if (r.ok) f = await out.embedFont(new Uint8Array(await r.arrayBuffer()), { subset: true }); } catch { }
    m.set(file, f);
  }
  if (m.get(file)) return m.get(file);
  // otherwise the 14 standard fonts (WinAnsi only), or the bundled Unicode font for other letters
  return WIN_ANSI.test(a.text) ? m.get(name) : fallback;
}
async function drawEdit(out, pg, a, conv, R, fallback) {
  const font = a.text.trim() ? await editFont(out, a, fallback) : null;
  const tw = font ? font.widthOfTextAtSize(a.text, a.size) + 2 : 0;
  const w = Math.max(a.w, tw), rot = a.rot || 0;
  const [cx, cy] = conv(...(() => { const [dx, dy] = rotv(0, a.h, rot); return [a.x + dx, a.y + dy]; })());
  pg.drawRectangle({ x: cx, y: cy, width: w, height: a.h, color: hexRgb(a.bg), borderWidth: 0, rotate: PDFLib.degrees(R - rot) });
  if (!font) return;
  const [lx, ly] = rotv(1, a.base, rot), [x, y] = conv(a.x + lx, a.y + ly);
  pg.drawText(a.text, { x, y, size: a.size, font, color: hexRgb(a.color), rotate: PDFLib.degrees(R - rot) });
}
