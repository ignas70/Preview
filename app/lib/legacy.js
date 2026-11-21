/* Simplified readers for older and open document formats:
   Word 97–2003 (.doc), PowerPoint 97–2003 (.ppt/.pps), RTF, OpenDocument text (.odt) and presentations (.odp).
   Output: { type: 'doc', blocks: [{t:'h1'|'h2'|'p'|'hr', text} | {t:'img', url}] }
       or  { type: 'slides', slides: [{ blocks: [[{t, text}]], images: [url] }] } */
(function () {
  'use strict';
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const utf16 = (b, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u16(b, o + 2 * i)); return s; };
  const cp1252 = new TextDecoder('windows-1252');
  const asBytes = c => c instanceof Uint8Array ? c : new Uint8Array(c);
  const isRtf = b => b.length > 5 && String.fromCharCode(b[0], b[1], b[2], b[3], b[4]) === '{\\rtf';

  function cfbStream(cfb, name) {
    const e = XLSX.CFB.find(cfb, name);
    return e && e.content ? asBytes(e.content) : null;
  }

  /* ---------------- Word 97-2003 ---------------- */
  function readDoc(bytes) {
    if (isRtf(bytes)) return readRtf(bytes);
    const cfb = XLSX.CFB.read(bytes, { type: 'array' });
    const wd = cfbStream(cfb, 'WordDocument');
    if (!wd) throw new Error('Not a Word document');
    const flags = u16(wd, 0x0A);
    if (flags & 0x0100) throw new Error('This document is password-protected');
    const nFib = u16(wd, 2);
    if (nFib < 101) throw new Error('Word 6/95 documents are not supported');
    const table = cfbStream(cfb, (flags & 0x0200) ? '1Table' : '0Table');
    if (!table) throw new Error('Damaged document (no table stream)');
    const csw = u16(wd, 32), lwStart = 34 + csw * 2 + 2, cslw = u16(wd, 34 + csw * 2);
    const ccpText = u32(wd, lwStart + 12);
    const fcStart = lwStart + cslw * 4 + 2;
    const fcClx = u32(wd, fcStart + 33 * 8), lcbClx = u32(wd, fcStart + 33 * 8 + 4);
    let text = '';
    let pos = fcClx; const end = fcClx + lcbClx;
    while (pos < end) {
      const clxt = table[pos];
      if (clxt === 1) { pos += 3 + u16(table, pos + 1); continue; }
      if (clxt !== 2) break;
      const lcb = u32(table, pos + 1), start = pos + 5, n = (lcb - 4) / 12;
      for (let i = 0; i < n; i++) {
        const cp0 = u32(table, start + i * 4), cp1 = u32(table, start + (i + 1) * 4);
        const fcRaw = u32(table, start + (n + 1) * 4 + i * 8 + 2);
        const count = cp1 - cp0;
        if (fcRaw & 0x40000000) { const off = (fcRaw & 0x3FFFFFFF) / 2; text += cp1252.decode(wd.subarray(off, off + count)); }
        else text += utf16(wd, fcRaw, count);
      }
      break;
    }
    if (!text) throw new Error('No text found');
    text = text.slice(0, ccpText);
    // drop field codes, keep field results
    let out = '', depth = [];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c === 0x13) { depth.push('code'); continue; }
      if (c === 0x14) { if (depth.length) depth[depth.length - 1] = 'result'; continue; }
      if (c === 0x15) { depth.pop(); continue; }
      if (depth.includes('code')) continue;
      out += ch;
    }
    return { type: 'doc', blocks: paragraphs(out) };
  }
  function paragraphs(s) {
    const blocks = [];
    for (const raw of s.split(/\r|\n(?!$)/)) {
      if (raw.includes('\f')) { const parts = raw.split('\f'); parts.forEach((p, i) => { if (i) blocks.push({ t: 'hr' }); pushP(blocks, p); }); continue; }
      pushP(blocks, raw);
    }
    return blocks;
  }
  function pushP(blocks, raw) {
    const t = raw.replace(/\x07/g, '\t').replace(/\x0B/g, '\n').replace(/\x1E/g, '-').replace(/[\x00-\x08\x0E-\x1F]/g, '').replace(/\t+$/, '');
    if (t.trim()) blocks.push({ t: 'p', text: t });
  }

  /* ---------------- PowerPoint 97-2003 ---------------- */
  function readPpt(bytes) {
    const cfb = XLSX.CFB.read(bytes, { type: 'array' });
    const doc = cfbStream(cfb, 'PowerPoint Document');
    if (!doc) throw new Error('Not a PowerPoint file');
    const recs = (b, start, end, cb, depth) => {
      let p = start;
      while (p + 8 <= end) {
        const verInst = u16(b, p), type = u16(b, p + 2), len = u32(b, p + 4);
        const ver = verInst & 0xF, inst = verInst >> 4, body = p + 8;
        if (body + len > end + 1) break;
        cb(type, inst, body, len, depth);
        if (ver === 0xF && depth < 12) recs(b, body, body + len, cb, depth + 1);
        p = body + len;
      }
    };
    // Files saved with "fast save" keep stale copies of edited records; the live Document record is the last one.
    let docStart = 0, docEnd = doc.length;
    recs(doc, 0, doc.length, (type, inst, body, len, depth) => { if (type === 0x03E8 && depth === 0) { docStart = body - 8; docEnd = body + len; } }, 0);
    // 1) the slide list with text (present in most files, in presentation order)
    let slides = [], cur = null, ttype = 1, inList = false, listEnd = 0;
    recs(doc, docStart, docEnd, (type, inst, body, len) => {
      if (type === 0x0FF0) { inList = inst === 0; listEnd = body + len; return; }
      if (!inList || body >= listEnd) { inList = inList && body < listEnd; return; }
      if (type === 0x03F3) { cur = { blocks: [], images: [] }; slides.push(cur); return; }
      if (!cur) return;
      if (type === 0x0F9F) ttype = u32(doc, body);
      else if (type === 0x0FA0 || type === 0x0FA8) addText(cur, type === 0x0FA0 ? utf16(doc, body, len / 2) : cp1252.decode(doc.subarray(body, body + len)), ttype);
    }, 0);
    // 2) otherwise collect text inside each slide container
    if (!slides.some(s => s.blocks.length)) {
      slides = []; let inSlide = -1;
      recs(doc, 0, doc.length, (type, inst, body, len) => {
        if (type === 0x03EE) { cur = { blocks: [], images: [], end: body + len }; slides.push(cur); return; }
        if (!cur || body >= cur.end) return;
        if (type === 0x0F9F) ttype = u32(doc, body);
        else if (type === 0x0FA0 || type === 0x0FA8) addText(cur, type === 0x0FA0 ? utf16(doc, body, len / 2) : cp1252.decode(doc.subarray(body, body + len)), ttype);
      }, 0);
    }
    // pictures stored in the file (shown after the slides)
    const pics = cfbStream(cfb, 'Pictures'), images = [];
    if (pics) {
      let p = 0;
      while (p + 8 <= pics.length) {
        const inst = u16(pics, p) >> 4, type = u16(pics, p + 2), len = u32(pics, p + 4), body = p + 8;
        const kind = type === 0xF01D || type === 0xF02A ? 'image/jpeg' : type === 0xF01E ? 'image/png' : null;
        if (kind) {
          const twoIds = kind === 'image/png' ? inst === 0x6E1 : (inst === 0x46B || inst === 0x6E3);
          const skip = 16 * (twoIds ? 2 : 1) + 1;
          if (len > skip) images.push(URL.createObjectURL(new Blob([pics.subarray(body + skip, body + len)], { type: kind })));
        }
        p = body + len;
      }
    }
    return { type: 'slides', slides: slides.filter(s => s.blocks.length).map(s => ({ blocks: s.blocks, images: [] })), images };
  }
  function addText(slide, text, ttype) {
    const t = ttype === 0 || ttype === 6 ? 'h1' : 'p';   // 0 = title, 6 = centred title
    const lines = text.split(/\r/).map(l => l.replace(/\x0B/g, '\n')).filter(l => l.trim());
    if (lines.length) slide.blocks.push(lines.map(l => ({ t, text: l })));
  }

  /* ---------------- RTF ---------------- */
  function readRtf(bytes) {
    const s = cp1252.decode(bytes);
    const skipDest = /^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|xmlnstbl|rsidtbl|listtable|listoverridetable|generator|header|footer|headerl|headerr|footerl|footerr|fldinst|filetbl|revtbl|mmathPr|pgdsctbl)$/;
    let out = '', i = 0, uc = 1, pendingSkip = 0, dec = cp1252, hexBuf = [];
    const stack = []; let skipping = false;
    const flushHex = () => { if (hexBuf.length) { if (!skipping) out += dec.decode(new Uint8Array(hexBuf)); hexBuf = []; } };
    while (i < s.length) {
      const c = s[i];
      if (c === '{') { flushHex(); stack.push({ skipping, uc }); i++; continue; }
      if (c === '}') { flushHex(); const st = stack.pop(); if (st) { skipping = st.skipping; uc = st.uc; } i++; continue; }
      if (c === '\\') {
        const n = s[i + 1];
        if (n === '\\' || n === '{' || n === '}') { flushHex(); if (!skipping) out += n; i += 2; continue; }
        if (n === "'") { const h = parseInt(s.substr(i + 2, 2), 16); if (pendingSkip > 0) pendingSkip--; else hexBuf.push(h); i += 4; continue; }
        if (n === '*') { skipping = true; i += 2; continue; }
        if (n === '~') { flushHex(); if (!skipping) out += ' '; i += 2; continue; }
        if (n === '-' || n === '_') { i += 2; continue; }
        const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 40));
        if (!m) { i += 2; continue; }
        flushHex();
        const w = m[1], arg = m[2] != null ? +m[2] : null;
        i += 1 + m[0].length;
        if (skipDest.test(w)) { skipping = true; continue; }
        if (w === 'ansicpg' && arg) { try { dec = new TextDecoder('windows-' + arg); } catch { } continue; }
        if (skipping) continue;
        if (w === 'par' || w === 'line' || w === 'sect') out += '\n';
        else if (w === 'page') out += '\f';
        else if (w === 'tab' || w === 'cell') out += '\t';
        else if (w === 'row') out += '\n';
        else if (w === 'uc') uc = arg || 0;
        else if (w === 'u') { out += String.fromCharCode(arg < 0 ? arg + 65536 : arg); pendingSkip = uc; }
        else if (w === 'emdash') out += '—'; else if (w === 'endash') out += '–';
        else if (w === 'lquote') out += '‘'; else if (w === 'rquote') out += '’';
        else if (w === 'ldblquote') out += '“'; else if (w === 'rdblquote') out += '”'; else if (w === 'bullet') out += '•';
        continue;
      }
      if (c === '\r' || c === '\n') { i++; continue; }
      flushHex();
      if (pendingSkip > 0) { pendingSkip--; i++; continue; }
      if (!skipping) out += c;
      i++;
    }
    flushHex();
    return { type: 'doc', blocks: paragraphs(out.replace(/\n/g, '\r')) };
  }

  /* ---------------- OpenDocument (.odt / .odp) ---------------- */
  const NS = { text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', pres: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0', xlink: 'http://www.w3.org/1999/xlink', table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0' };
  function odText(node) {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.namespaceURI === NS.text && n.localName === 's') s += ' '.repeat(+(n.getAttributeNS(NS.text, 'c') || 1));
      else if (n.namespaceURI === NS.text && n.localName === 'tab') s += '\t';
      else if (n.namespaceURI === NS.text && n.localName === 'line-break') s += '\n';
      else if (n.nodeType === 1 && !(n.namespaceURI === NS.text && n.localName === 'note')) s += odText(n);
    }
    return s;
  }
  async function odImage(zip, frame) {
    const img = frame.getElementsByTagNameNS(NS.draw, 'image')[0];
    const href = img && img.getAttributeNS(NS.xlink, 'href');
    const f = href && zip.file(href.replace(/^\.\//, ''));
    if (!f) return null;
    const type = /\.png$/i.test(href) ? 'image/png' : /\.(jpe?g)$/i.test(href) ? 'image/jpeg' : /\.gif$/i.test(href) ? 'image/gif' : /\.svg$/i.test(href) ? 'image/svg+xml' : null;
    if (!type) return null;
    return URL.createObjectURL(new Blob([await f.async('uint8array')], { type }));
  }
  async function readOdf(bytes, ext) {
    const zip = await JSZip.loadAsync(bytes);
    const xml = zip.file('content.xml');
    if (!xml) throw new Error('Not an OpenDocument file');
    const dom = new DOMParser().parseFromString(await xml.async('string'), 'application/xml');
    if (ext === 'odp') {
      const slides = [];
      for (const pg of dom.getElementsByTagNameNS(NS.draw, 'page')) {
        const s = { blocks: [], images: [] };
        for (const fr of pg.getElementsByTagNameNS(NS.draw, 'frame')) {
          const cls = fr.getAttributeNS(NS.pres, 'class') || '';
          if (cls === 'notes') continue;
          const lines = [...fr.getElementsByTagNameNS(NS.text, 'p')].map(odText).filter(t => t.trim());
          if (lines.length) s.blocks.push(lines.map(t => ({ t: cls === 'title' ? 'h1' : cls === 'subtitle' ? 'h2' : 'p', text: t })));
          const im = await odImage(zip, fr); if (im) s.images.push(im);
        }
        slides.push(s);
      }
      return { type: 'slides', slides, images: [] };
    }
    const body = dom.getElementsByTagNameNS(NS.office, 'text')[0];
    const blocks = [];
    const walk = async node => {
      for (const n of node.children) {
        const ln = n.localName, ns = n.namespaceURI;
        if (ns === NS.text && ln === 'h') { const lvl = +(n.getAttributeNS(NS.text, 'outline-level') || 1); const t = odText(n); if (t.trim()) blocks.push({ t: lvl <= 1 ? 'h1' : lvl === 2 ? 'h2' : 'h3', text: t }); }
        else if (ns === NS.text && ln === 'p') {
          const t = odText(n); if (t.trim()) blocks.push({ t: 'p', text: t });
          for (const fr of n.getElementsByTagNameNS(NS.draw, 'frame')) { const im = await odImage(zip, fr); if (im) blocks.push({ t: 'img', url: im }); }
        }
        else if (ns === NS.text && (ln === 'list' || ln === 'list-item' || ln === 'section')) await walk(n);
        else if (ns === NS.table && ln === 'table') {
          for (const row of n.getElementsByTagNameNS(NS.table, 'table-row')) {
            const cells = [...row.getElementsByTagNameNS(NS.table, 'table-cell')].map(odText).map(s => s.trim());
            if (cells.some(Boolean)) blocks.push({ t: 'p', text: cells.join('\t') });
          }
        }
      }
    };
    await walk(body);
    return { type: 'doc', blocks };
  }

  window.Legacy = {
    async read(bytes, ext) {
      bytes = asBytes(bytes);
      if (ext === 'rtf') return readRtf(bytes);
      if (ext === 'doc' || ext === 'dot') return readDoc(bytes);
      if (ext === 'ppt' || ext === 'pps') return readPpt(bytes);
      if (ext === 'odt' || ext === 'odp') return readOdf(bytes, ext);
      throw new Error('Unsupported format');
    },
  };
})();
