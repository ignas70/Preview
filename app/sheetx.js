'use strict';
/* Preview – Excel fidelity: cell colours, fonts, borders, alignment, row/column sizes (via ExcelJS),
   and charts / pictures from the sheet's drawings (own parser + SVG renderer). */

const OFFICE_THEME = ['000000', 'FFFFFF', '44546A', 'E7E6E6', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

// theme colours in Excel's index order: lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink
function parseTheme(xml) {
  if (!xml) return OFFICE_THEME.slice();
  try {
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    const sch = d.getElementsByTagNameNS('*', 'clrScheme')[0]; if (!sch) return OFFICE_THEME.slice();
    const get = n => { const e = sch.getElementsByTagNameNS('*', n)[0]; if (!e) return null; const c = e.firstElementChild; return c ? (c.getAttribute('val') && c.localName === 'srgbClr' ? c.getAttribute('val') : c.getAttribute('lastClr') || c.getAttribute('val')) : null; };
    const t = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(get);
    return t.map((v, i) => v || OFFICE_THEME[i]);
  } catch { return OFFICE_THEME.slice(); }
}
function tint(hex, t) {
  if (!t) return hex;
  let r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const f = (p, q, x) => { if (x < 0) x += 1; if (x > 1) x -= 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < .5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  let R, G, B; if (!s) R = G = B = l; else { const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; R = f(p, q, h + 1 / 3); G = f(p, q, h); B = f(p, q, h - 1 / 3); }
  return [R, G, B].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function xlColor(c, theme) {
  if (!c) return null;
  if (c.argb) return '#' + c.argb.slice(-6);
  if (c.theme != null) return '#' + tint(theme[c.theme] || '000000', c.tint || 0);
  if (c.indexed != null) return c.indexed === 64 ? '#000000' : c.indexed === 65 ? '#FFFFFF' : '#' + (INDEXED[c.indexed] || '000000');
  return null;
}
function cellCss(st, theme) {
  if (!st) return '';
  const o = [];
  const f = st.font;
  if (f) {
    if (f.bold) o.push('font-weight:700'); if (f.italic) o.push('font-style:italic');
    const dec = [f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' '); if (dec) o.push('text-decoration:' + dec);
    if (f.size && f.size !== 11) o.push('font-size:' + f.size + 'pt');
    if (f.name && !/^Calibri$/i.test(f.name)) o.push(`font-family:"${f.name.replace(/"/g, '')}",Calibri,sans-serif`);
    const col = xlColor(f.color, theme); if (col) o.push('color:' + col);
  }
  const fill = st.fill;
  if (fill && fill.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
    const bg = xlColor(fill.fgColor, theme) || xlColor(fill.bgColor, theme); if (bg) o.push('background:' + bg);
  } else if (fill && fill.type === 'gradient' && fill.stops && fill.stops.length) {
    const bg = xlColor(fill.stops[0].color, theme); if (bg) o.push('background:' + bg);
  }
  const b = st.border;
  if (b) for (const side of ['top', 'right', 'bottom', 'left']) {
    const s = b[side]; if (!s || !s.style) continue;
    const w = { medium: 2, thick: 3, double: 3, mediumDashed: 2, mediumDashDot: 2 }[s.style] || 1;
    const kind = /double/.test(s.style) ? 'double' : /dash/i.test(s.style) ? 'dashed' : /dot|hair/i.test(s.style) ? 'dotted' : 'solid';
    o.push(`border-${side}:${w}px ${kind} ${xlColor(s.color, theme) || '#000'}`);
  }
  const a = st.alignment;
  if (a) {
    if (a.horizontal && a.horizontal !== 'general') o.push('text-align:' + ({ centerContinuous: 'center', fill: 'left', distributed: 'justify' }[a.horizontal] || a.horizontal));
    if (a.vertical) o.push('vertical-align:' + ({ middle: 'middle', top: 'top', bottom: 'bottom', distributed: 'middle', justify: 'middle' }[a.vertical] || 'bottom'));
    if (a.wrapText) o.push('white-space:normal;text-overflow:clip');
    if (a.indent) o.push('padding-left:' + (6 + a.indent * 9) + 'px');
  }
  return o.join(';');
}

/* ---------- reading the workbook ---------- */
async function excelExtras(ab) {
  await Promise.all([loadLib('lib/exceljs.min.js'), loadLib('lib/jszip.min.js')]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ab.slice(0));
  const themeXml = wb._themes && (wb._themes.theme1 || Object.values(wb._themes)[0]);
  const theme = parseTheme(themeXml);
  const out = new Map();
  for (const ws of wb.worksheets) {
    const cells = new Map(), colW = [], rowH = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      if (row.height) rowH[r - 1] = row.height * 96 / 72;
      if (row.hidden) rowH[r - 1] = 0;
      row.eachCell({ includeEmpty: true }, (cell, c) => { const css = cellCss(cell.style, theme); if (css) cells.set((r - 1) + ',' + (c - 1), css); });
    });
    (ws.columns || []).forEach((col, i) => { if (col && col.hidden) colW[i] = 0; else if (col && col.width) colW[i] = Math.round(col.width * 7 + 5); });
    out.set(ws.name, { cells, colW, rowH, drawings: [] });
  }
  try { await readDrawings(ab, out, theme); } catch (e) { console.warn('drawings', e); }
  return out;
}

/* ---------- drawings: charts and pictures ---------- */
const relTargets = async (zip, relPath) => {
  const f = zip.file(relPath); const map = new Map(); if (!f) return map;
  const d = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  for (const r of d.getElementsByTagName('Relationship')) map.set(r.getAttribute('Id'), { target: r.getAttribute('Target'), type: r.getAttribute('Type') || '' });
  return map;
};
const resolve = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
};
const relsOf = path => path.replace(/([^/]+)$/, '_rels/$1.rels');
async function readDrawings(ab, out, theme) {
  const zip = await JSZip.loadAsync(ab);
  const wbXml = new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml');
  const wbRels = await relTargets(zip, 'xl/_rels/workbook.xml.rels');
  for (const s of wbXml.getElementsByTagNameNS('*', 'sheet')) {
    const name = s.getAttribute('name'), rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
    const rel = wbRels.get(rid); if (!rel || !out.has(name)) continue;
    const sheetPath = resolve('xl/workbook.xml', rel.target);
    const sRels = await relTargets(zip, relsOf(sheetPath));
    for (const [, r] of sRels) {
      if (!/\/drawing$/.test(r.type)) continue;
      const dPath = resolve(sheetPath, r.target), dFile = zip.file(dPath); if (!dFile) continue;
      const dXml = new DOMParser().parseFromString(await dFile.async('string'), 'application/xml');
      const dRels = await relTargets(zip, relsOf(dPath));
      const anchors = [...dXml.documentElement.children].filter(e => /Anchor$/.test(e.localName));
      for (const an of anchors) {
        const pos = n => { const e = an.getElementsByTagNameNS('*', n)[0]; if (!e) return null; const g = t => +((e.getElementsByTagNameNS('*', t)[0] || {}).textContent || 0); return { c: g('col'), co: g('colOff'), r: g('row'), ro: g('rowOff') }; };
        const from = pos('from') || { c: 0, co: 0, r: 0, ro: 0 };
        let to = pos('to');
        if (!to) { const ext = an.getElementsByTagNameNS('*', 'ext')[0]; const cx = +(ext && ext.getAttribute('cx') || 4572000), cy = +(ext && ext.getAttribute('cy') || 2743200); to = { c: from.c, co: from.co + cx, r: from.r, ro: from.ro + cy }; }
        const ch = an.getElementsByTagNameNS('*', 'chart')[0];
        const blip = an.getElementsByTagNameNS('*', 'blip')[0];
        const ridOf = e => e.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || e.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || e.getAttribute('r:id') || e.getAttribute('r:embed');
        if (ch) {
          const cr = dRels.get(ridOf(ch)); if (!cr) continue;
          const cf = zip.file(resolve(dPath, cr.target)); if (!cf) continue;
          const chart = parseChart(await cf.async('string'), theme);
          if (chart) out.get(name).drawings.push({ type: 'chart', from, to, chart });
        } else if (blip) {
          const br = dRels.get(ridOf(blip)); if (!br) continue;
          const path = resolve(dPath, br.target), bf = zip.file(path); if (!bf) continue;
          const type = /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.gif$/i.test(path) ? 'image/gif' : null; if (!type) continue;
          out.get(name).drawings.push({ type: 'pic', from, to, url: URL.createObjectURL(new Blob([await bf.async('uint8array')], { type })) });
        }
      }
    }
  }
}

function parseChart(xml, theme) {
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  const q = (e, n) => e ? e.getElementsByTagNameNS('*', n)[0] : null, qa = (e, n) => e ? [...e.getElementsByTagNameNS('*', n)] : [];
  const val = (e, n) => { const x = q(e, n); return x ? x.getAttribute('val') : null; };
  const chartEl = q(d, 'chart'); const plot = q(chartEl, 'plotArea'); if (!plot) return null;
  const titleEl = [...chartEl.children].find(e => e.localName === 'title');
  let title = titleEl ? qa(titleEl, 't').map(t => t.textContent).join('') : '';
  const pts = e => { if (!e) return []; const a = []; for (const p of qa(e, 'pt')) { const v = q(p, 'v'); a[+p.getAttribute('idx')] = v ? v.textContent : ''; } const cnt = q(e, 'ptCount'); const n = cnt ? +cnt.getAttribute('val') : a.length; return Array.from({ length: n }, (_, i) => a[i] ?? ''); };
  const colorOf = sp => { if (!sp) return null; const f = [...sp.children].find(e => e.localName === 'solidFill') || q(sp, 'ln') && q(q(sp, 'ln'), 'solidFill'); if (!f) return null; const s = q(f, 'srgbClr'); if (s) return '#' + s.getAttribute('val'); const sc = q(f, 'schemeClr'); if (sc) { const m = { accent1: 4, accent2: 5, accent3: 6, accent4: 7, accent5: 8, accent6: 9, tx1: 1, dk1: 1, bg1: 0, lt1: 0, tx2: 3, dk2: 3 }[sc.getAttribute('val')]; return m != null ? '#' + theme[m] : null; } return null; };
  const groups = [];
  for (const g of plot.children) {
    const t = g.localName.replace(/3D/, '');
    if (!/^(bar|line|pie|doughnut|area|scatter|radar)Chart$/.test(t)) continue;
    const kind = t.replace('Chart', '');
    const series = qa(g, 'ser').filter(s => s.parentNode === g).map((s, i) => {
      const tx = q(s, 'tx');
      return {
        name: tx ? pts(q(tx, 'strCache'))[0] || (q(tx, 'v') || {}).textContent || `Series ${i + 1}` : `Series ${i + 1}`,
        cats: pts(q(q(s, 'cat') || q(s, 'xVal'), 'strCache') || q(q(s, 'cat') || q(s, 'xVal'), 'numCache')),
        vals: pts(q(q(s, 'val') || q(s, 'yVal'), 'numCache')).map(v => v === '' ? null : +v),
        color: colorOf([...s.children].find(e => e.localName === 'spPr')),
        pointColors: qa(s, 'dPt').map(dp => ({ i: +val(dp, 'idx'), c: colorOf(q(dp, 'spPr')) })),
      };
    });
    groups.push({ kind, bar: val(g, 'barDir') === 'bar', grouping: val(g, 'grouping') || 'clustered', hole: kind === 'doughnut' ? +(val(g, 'holeSize') || 50) : 0, series });
  }
  if (!groups.length) return null;
  if (!title && !q(chartEl, 'autoTitleDeleted') && groups[0].series.length === 1) title = groups[0].series[0].name;
  const autoDeleted = val(chartEl, 'autoTitleDeleted') === '1';
  return { title: autoDeleted && !titleEl ? '' : title, groups, legend: !!q(chartEl, 'legend') };
}

/* ---------- placing and drawing ---------- */
function placeDrawings(canvas, drawings) {
  const table = canvas.querySelector('table'); if (!table) return;
  const heads = [...table.querySelectorAll('thead th')].slice(1);
  const rowsEl = new Map([...table.querySelectorAll('tbody tr')].map(tr => [+tr.dataset.r, tr]));
  const colX = c => { const th = heads[Math.min(c, heads.length - 1)]; return th ? th.offsetLeft + (c >= heads.length ? th.offsetWidth * (c - heads.length + 1) : 0) : 0; };
  const rowY = r => { let tr = rowsEl.get(r); if (tr) return tr.offsetTop; const last = [...rowsEl.values()].pop(); return last ? last.offsetTop + last.offsetHeight * (r - +last.dataset.r) : 0; };
  for (const d of drawings) {
    const x0 = colX(d.from.c) + d.from.co / 9525, y0 = rowY(d.from.r) + d.from.ro / 9525;
    const x1 = colX(d.to.c) + d.to.co / 9525, y1 = rowY(d.to.r) + d.to.ro / 9525;
    const box = el('div', 'xlDrawing' + (d.type === 'pic' ? ' pic' : ''));
    Object.assign(box.style, { left: x0 + 'px', top: y0 + 'px', width: Math.max(40, x1 - x0) + 'px', height: Math.max(30, y1 - y0) + 'px' });
    if (d.type === 'pic') { const im = el('img'); im.src = d.url; box.append(im); }
    else box.innerHTML = chartSvg(d.chart, Math.max(40, x1 - x0), Math.max(30, y1 - y0));
    canvas.append(box);
  }
}
const PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E', '#636363', '#997300'];
function niceScale(min, max, ticks = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / ticks, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}
const fmtNum = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : String(Math.round(v * 100) / 100);
function chartSvg(ch, W, H) {
  const e = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const g0 = ch.groups[0], o = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`];
  let top = 10;
  if (ch.title) { o.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="14" fill="#404040">${e(ch.title)}</text>`); top = 34; }
  const pie = g0.kind === 'pie' || g0.kind === 'doughnut';
  const legendItems = pie ? g0.series[0].cats.map((c, i) => [c, (g0.series[0].pointColors.find(p => p.i === i) || {}).c || PALETTE[i % PALETTE.length]])
    : ch.groups.flatMap(g => g.series).map((s, i) => [s.name, s.color || PALETTE[i % PALETTE.length]]);
  const legendH = ch.legend && legendItems.length ? 22 : 0;
  const bottom = H - legendH - 6;
  if (legendH) {
    let x = 0; const parts = legendItems.map(([n, c]) => { const w = 18 + Math.min(120, String(n).length * 6.5) + 12; const r = { n, c, x }; x += w; return r; });
    const off = Math.max(6, (W - x) / 2);
    for (const p of parts) o.push(`<rect x="${off + p.x}" y="${H - 17}" width="9" height="9" fill="${p.c}"/><text x="${off + p.x + 13}" y="${H - 9}" font-size="11" fill="#595959">${e(String(p.n).slice(0, 18))}</text>`);
  }
  if (pie) {
    const s = g0.series[0], vals = s.vals.map(v => Math.max(0, v || 0)), total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2, cy = (top + bottom) / 2, r = Math.max(10, Math.min(W / 2 - 12, (bottom - top) / 2 - 4)), hole = r * g0.hole / 100;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + v / total * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0, col = (s.pointColors.find(p => p.i === i) || {}).c || PALETTE[i % PALETTE.length];
      const P = (a, rr) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      if (v >= total) o.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}"/>`);
      else o.push(`<path d="M${P(a0, hole || 0.001)} L${P(a0, r)} A${r},${r} 0 ${large} 1 ${P(a1, r)} L${P(a1, hole || 0.001)} ${hole ? `A${hole},${hole} 0 ${large} 0 ${P(a0, hole)}` : ''} Z" fill="${col}" stroke="#fff" stroke-width="1.5"/>`);
      if (v / total > 0.04) { const am = (a0 + a1) / 2, rr = hole ? (r + hole) / 2 : r * 0.62; o.push(`<text x="${cx + rr * Math.cos(am)}" y="${cy + rr * Math.sin(am) + 4}" text-anchor="middle" font-size="11" fill="#fff">${Math.round(v / total * 100)}%</text>`); }
      a0 = a1;
    });
    if (hole) o.push(`<circle cx="${cx}" cy="${cy}" r="${hole}" fill="#fff"/>`);
    o.push('</svg>'); return o.join('');
  }
  // category / value charts
  const all = ch.groups.flatMap(g => g.series);
  const cats = (all.find(s => s.cats.length) || { cats: [] }).cats;
  const n = Math.max(cats.length, ...all.map(s => s.vals.length));
  const stacked = g => /stacked/i.test(g.grouping);
  let lo = 0, hi = 0;
  for (const g of ch.groups) {
    if (stacked(g)) for (let i = 0; i < n; i++) { let pos = 0, neg = 0; for (const s of g.series) { const v = s.vals[i] || 0; if (v >= 0) pos += v; else neg += v; } hi = Math.max(hi, /percent/i.test(g.grouping) ? 100 : pos); lo = Math.min(lo, neg); }
    else for (const s of g.series) for (const v of s.vals) if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
  }
  const sc = niceScale(lo, hi);
  const horizontal = ch.groups.some(g => g.kind === 'bar' && g.bar);
  const left = horizontal ? Math.min(110, 10 + Math.max(...cats.map(c => String(c).length)) * 6) : 10 + String(fmtNum(sc.hi)).length * 7, right = W - 12, pTop = top + 4, pBot = bottom - (horizontal ? 18 : 20);
  const pw = Math.max(10, right - left), ph = Math.max(10, pBot - pTop);
  const vpos = v => horizontal ? left + (v - sc.lo) / (sc.hi - sc.lo) * pw : pBot - (v - sc.lo) / (sc.hi - sc.lo) * ph;
  for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) {
    const p = vpos(v);
    if (horizontal) o.push(`<line x1="${p}" y1="${pTop}" x2="${p}" y2="${pBot}" stroke="#d9d9d9"/><text x="${p}" y="${pBot + 13}" text-anchor="middle" font-size="10" fill="#595959">${fmtNum(v)}</text>`);
    else o.push(`<line x1="${left}" y1="${p}" x2="${right}" y2="${p}" stroke="#d9d9d9"/><text x="${left - 4}" y="${p + 3}" text-anchor="end" font-size="10" fill="#595959">${fmtNum(v)}</text>`);
  }
  const band = (horizontal ? ph : pw) / Math.max(1, n);
  const every = Math.ceil(n / Math.max(1, Math.floor((horizontal ? ph / 14 : pw / 48))));
  cats.forEach((c, i) => {
    if (i % every) return;
    const mid = (horizontal ? pTop : left) + band * (i + 0.5), label = e(String(c).slice(0, horizontal ? 18 : 12));
    if (horizontal) o.push(`<text x="${left - 4}" y="${mid + 3}" text-anchor="end" font-size="10" fill="#595959">${label}</text>`);
    else o.push(`<text x="${mid}" y="${pBot + 13}" text-anchor="middle" font-size="10" fill="#595959">${label}</text>`);
  });
  let sIdx = 0;
  for (const g of ch.groups) {
    const ser = g.series, k = ser.length;
    if (g.kind === 'bar') {
      const gap = band * 0.25, bw = stacked(g) ? band - 2 * gap : (band - 2 * gap) / Math.max(1, k);
      const base = new Array(n).fill(0), baseNeg = new Array(n).fill(0);
      ser.forEach((s, si) => {
        const col = s.color || PALETTE[(sIdx + si) % PALETTE.length];
        s.vals.forEach((v0, i) => {
          if (v0 == null) return;
          let v = v0;
          if (/percent/i.test(g.grouping)) { const tot = ser.reduce((a, t) => a + Math.abs(t.vals[i] || 0), 0) || 1; v = v0 / tot * 100; }
          const start = stacked(g) ? (v >= 0 ? base[i] : baseNeg[i]) : 0, end = start + v;
          if (stacked(g)) { if (v >= 0) base[i] = end; else baseNeg[i] = end; }
          const off = (horizontal ? pTop : left) + band * i + gap + (stacked(g) ? 0 : bw * si);
          const a = vpos(Math.max(sc.lo, Math.min(start, end))), b = vpos(Math.min(sc.hi, Math.max(start, end)));
          const pc = (s.pointColors.find(p => p.i === i) || {}).c || col;
          if (horizontal) o.push(`<rect x="${a}" y="${off}" width="${Math.max(0, b - a)}" height="${bw}" fill="${pc}"/>`);
          else o.push(`<rect x="${off}" y="${b}" width="${bw}" height="${Math.max(0, a - b)}" fill="${pc}"/>`);
        });
      });
    } else if (g.kind === 'line' || g.kind === 'area' || g.kind === 'scatter' || g.kind === 'radar') {
      const acc = new Array(n).fill(0);
      ser.forEach((s, si) => {
        const col = s.color || PALETTE[(sIdx + si) % PALETTE.length];
        const ptsXY = s.vals.map((v, i) => { if (v == null) return null; const y = stacked(g) ? (acc[i] += v) : v; return [left + band * (i + 0.5), vpos(y)]; }).filter(Boolean);
        if (!ptsXY.length) return;
        const d = ptsXY.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        if (g.kind === 'area') o.push(`<path d="${d} L${ptsXY[ptsXY.length - 1][0]},${vpos(Math.max(0, sc.lo))} L${ptsXY[0][0]},${vpos(Math.max(0, sc.lo))} Z" fill="${col}" fill-opacity=".75"/>`);
        else if (g.kind !== 'scatter') o.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="2.25" stroke-linejoin="round"/>`);
        if (g.kind === 'scatter' || ptsXY.length < 25) for (const p of ptsXY) o.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${g.kind === 'scatter' ? 3.5 : 2.5}" fill="${col}"/>`);
      });
    }
    sIdx += k;
  }
  o.push(`<line x1="${left}" y1="${horizontal ? pTop : vpos(Math.max(0, sc.lo))}" x2="${horizontal ? left : right}" y2="${horizontal ? pBot : vpos(Math.max(0, sc.lo))}" stroke="#bfbfbf"/>`);
  o.push('</svg>');
  return o.join('');
}
