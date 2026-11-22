'use strict';
/* Preview – logic for quick stamps and editing the existing text of a PDF (no screen code;
   the menus, hover box and editing box are in pdfedit.js). */

/* ================= quick stamps ================= */
const Profile = {
  get() { try { return JSON.parse(localStorage.getItem('preview.profile') || '{}'); } catch { return {}; } },
  set(p) { try { localStorage.setItem('preview.profile', JSON.stringify(p)); } catch { } },
};
const initialsOf = n => (n || '').trim().split(/[\s-]+/).filter(Boolean).map(w => w[0].toUpperCase() + '.').join(' ');
const todayStr = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
// the stamps offered for a saved profile: the date always, name and initials once a name is known
function stampTexts(profile, date) {
  const name = (profile.name || '').trim(), ini = profile.initials || initialsOf(name);
  const out = [{ text: date, hint: "today's date" }];
  if (name) out.push({ text: name, hint: 'your name' }, { text: ini, hint: 'your initials' },
    { text: `${name}, ${date}`, hint: 'name and date' }, { text: `${ini} ${date}`, hint: 'initials and date' });
  return out;
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
