'use strict';
/* Preview – PDF → Markdown. pdfToMarkdown() is plain logic over text lines; pdfMarkdown() collects those lines
   from the open pages (the PDF's own text, or recognised OCR words on scanned pages).
   A PDF only stores where each piece of text is drawn, so the structure is guessed: bigger text is a heading,
   lines close together form a paragraph, "•" or "1." starts a list item, a typewriter font is code.
   Tables and multi-column layouts come out as plain lines. */

const P2M_BULLET = /^[•●▪◦‣■□·–\-*]\s+(.*)$/;
const P2M_NUMBER = /^(\d{1,3})[.)]\s+(.*)$/;
const P2M_PAGE_NO = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;

// text that Markdown would read as formatting gets a backslash in front
const p2mEscape = s => s.replace(/([\\`*_[\]<>])/g, '\\$1');
// ...and so does a paragraph that would otherwise start a heading, quote or list
const p2mEscapeStart = s => p2mEscape(s).replace(/^(\d+)([.)])(\s)/, '$1\\$2$3').replace(/^([#>+-])/, '\\$1');

// pages: [{ width, height, lines: [{ str, x, w, base, size, bold, fam }] }], lines top to bottom (base = y from the top)
function pdfToMarkdown(pages) {
  const all = pages.flatMap(p => p.lines);
  if (!all.length) return '';
  const r = v => Math.round(v * 2) / 2;
  const weight = new Map();
  for (const l of all) weight.set(r(l.size), (weight.get(r(l.size)) || 0) + l.str.length);
  const body = [...weight].sort((a, b) => b[1] - a[1])[0][0];
  const sentence = s => /,$/.test(s.trim()) || /[.;:]$/.test(s.trim()) && s.trim().split(/\s+/).length > 4;   // headings rarely end like a sentence
  const headLike = l => l.fam !== 'mono' && l.str.length <= 150 && l.size >= body * 1.15 && !sentence(l.str);
  const headSizes = [...new Set(all.filter(headLike).map(l => r(l.size)))].sort((a, b) => b - a);
  const levelOf = l => headLike(l) ? Math.min(headSizes.indexOf(r(l.size)) + 1, 4) : 0;

  // lines repeated at the top or bottom of most pages (running headers, footers) and bare page numbers
  const edge = (l, p) => l.base < p.height * 0.09 || l.base > p.height * 0.91;
  const key = s => s.replace(/\d+/g, '#').trim().toLowerCase();
  const seen = new Map();
  for (const p of pages) for (const k of new Set(p.lines.filter(l => edge(l, p)).map(l => key(l.str)))) seen.set(k, (seen.get(k) || 0) + 1);
  const repeated = k => pages.length >= 3 && (seen.get(k) || 0) >= Math.max(3, pages.length * 0.6);
  // footnote and author marks like "∗", "1" or a row of them
  const marker = l => l.size < body * 0.8 && (l.str.trim().length <= 3 || !/[\p{L}\p{N}]{2}/u.test(l.str));
  const skip = (l, p) => marker(l) || edge(l, p) && (P2M_PAGE_NO.test(l.str.trim()) || repeated(key(l.str)));

  const blocks = [];
  let cur = null;   // { kind: 'p' | 'h' | 'li' | 'code', text, size, bold, level, last }
  const flush = () => { if (cur) blocks.push(cur); cur = null; };
  const left = Math.min(...all.map(l => l.x));
  for (const p of pages) {
    let first = true;
    const lines = p2mReadingOrder(p.lines.filter(l => !skip(l, p)), p.width);
    const rightEdge = p.width ? Math.min(...lines.filter(l => l.x >= p.width * 0.48).map(l => l.x)) : Infinity;
    for (const l of lines) {
      const str = l.str.trim(), level = levelOf(l);
      const gap = cur ? l.base - cur.last.base : 0;
      // a new page or the top of the next column: the paragraph goes on only if the text clearly runs on
      const jumped = first || gap < 0;
      const close = !!cur && (!jumped ? gap <= cur.last.size * 1.9 : cur.kind === 'p' && !/[.!?:;]$/.test(cur.text) && /^\p{Ll}/u.test(str));
      const sameLook = cur && Math.abs(cur.size - l.size) < 0.6 && cur.bold === l.bold;
      const colLeft = l.x >= rightEdge ? rightEdge : left;
      first = false;
      if (l.fam === 'mono') {
        if (cur && cur.kind === 'code' && !jumped && gap <= l.size * 2.2) cur.text += '\n' + str;
        else { flush(); cur = { kind: 'code', text: str, size: l.size, bold: l.bold }; }
      } else if (level) {
        if (cur && cur.kind === 'h' && cur.level === level && close) cur.text += ' ' + str;
        else { flush(); cur = { kind: 'h', level, text: str, size: l.size, bold: l.bold }; }
      } else if (P2M_BULLET.test(str) || P2M_NUMBER.test(str)) {
        flush();
        const b = str.match(P2M_BULLET), n = str.match(P2M_NUMBER), depth = Math.max(0, Math.min(2, Math.round((l.x - colLeft) / 18)));
        cur = { kind: 'li', mark: '  '.repeat(depth) + (b ? '-' : n[1] + '.'), text: b ? b[1] : n[2], size: l.size, bold: l.bold };
      } else if (cur && (cur.kind === 'p' || cur.kind === 'li') && close && sameLook) {
        cur.text = /\p{L}-$/u.test(cur.text) && /^\p{Ll}/u.test(str) ? cur.text.slice(0, -1) + str : cur.text + ' ' + str;
      } else { flush(); cur = { kind: 'p', text: str, size: l.size, bold: l.bold }; }
      cur.last = l;
    }
  }
  flush();

  let out = '';
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1];
    const sameList = b.kind === 'li' && prev && prev.kind === 'li' && /-$/.test(b.mark) === /-$/.test(prev.mark);
    if (i) out += sameList ? '\n' : '\n\n';
    if (b.kind === 'h') out += '#'.repeat(b.level) + ' ' + p2mEscape(b.text);
    else if (b.kind === 'code') out += '```\n' + b.text.replace(/```/g, '`\u200b``') + '\n```';
    else if (b.kind === 'li') out += b.mark + ' ' + p2mEscapeStart(b.text);
    else out += b.bold && b.text.length <= 100 ? '**' + p2mEscape(b.text) + '**' : p2mEscapeStart(b.text);
  });
  return out + '\n';
}

// Two-column pages: read the left column, then the right one. Lines that cross the middle (titles, wide
// figures) split the page into bands, and each band is read column by column.
function p2mReadingOrder(lines, width) {
  if (!width) return lines;
  const mid = width / 2, slack = width * 0.02;
  const side = l => l.x + l.w <= mid + slack ? 'L' : l.x >= mid - slack ? 'R' : 'S';
  const sides = lines.map(side);
  if (sides.filter(s => s === 'L').length < 6 || sides.filter(s => s === 'R').length < 6) return lines;
  const out = [];
  let left = [], right = [];
  lines.forEach((l, i) => {
    if (sides[i] === 'L') left.push(l);
    else if (sides[i] === 'R') right.push(l);
    else { out.push(...left, ...right, l); left = []; right = []; }
  });
  return out.concat(left, right);
}

// text lines of every page, ready for pdfToMarkdown
async function pdfMarkdown(pages) {
  const out = [];
  for (const p of pages) {
    const pg = await realPage(p), v = pg.getViewport({ scale: 1, rotation: 0 });
    let lines = (await textLines(p)).map(l => ({ ...l }));
    const words = S.ocr.get(ocrKey(p));
    if (!lines.length && words && words.length) lines = p2mOcrLines(words, v);
    out.push({ width: v.width, height: v.height, lines });
  }
  return pdfToMarkdown(out);
}

// recognised words (PDF coordinates) → lines like textLines() gives
function p2mOcrLines(words, v) {
  const ws = words.map(w => { const [x, base] = v.convertToViewportPoint(w.base[0], w.base[1]); return { str: w.text, x, base, size: w.size, w: w.w }; })
    .sort((a, b) => a.base - b.base || a.x - b.x);
  const lines = [];
  for (const w of ws) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.base - w.base) < l.size * 0.45) { l.parts.push(w); continue; }
    lines.push({ base: w.base, size: w.size, parts: [w] });
  }
  return lines.map(l => {
    l.parts.sort((a, b) => a.x - b.x);
    const sizes = l.parts.map(w => w.size).sort((a, b) => a - b);
    // recognised letter heights vary a little from line to line: snap them to 15% steps so equal text stays equal
    const size = 1.15 ** Math.round(Math.log(sizes[sizes.length >> 1]) / Math.log(1.15));
    const last = l.parts[l.parts.length - 1];
    return { str: l.parts.map(w => w.str).join(' '), x: l.parts[0].x, w: last.x + last.w - l.parts[0].x, base: l.base, size, bold: false, italic: false, fam: 'sans' };
  });
}
