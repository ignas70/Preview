/* Minimal Apple iWork (Pages / Keynote, 2013+) reader: text, paragraph styles, images, slide order.
   Format: ZIP with Index/*.iwa = Snappy-compressed protobuf archives; Data/* = media. */
(function () {
  'use strict';
  const td = new TextDecoder();

  function snappy(src) {
    let p = 0, len = 0, shift = 0;
    for (;;) { const b = src[p++]; len += (b & 0x7f) * Math.pow(2, shift); if (!(b & 0x80)) break; shift += 7; }
    const out = new Uint8Array(len); let o = 0;
    while (p < src.length) {
      const tag = src[p++], t = tag & 3;
      if (t === 0) {
        let l = tag >> 2;
        if (l >= 60) { const n = l - 59; l = 0; for (let i = 0; i < n; i++) l |= src[p++] << (8 * i); }
        l += 1; out.set(src.subarray(p, p + l), o); p += l; o += l;
      } else {
        let l, off;
        if (t === 1) { l = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[p++]; }
        else if (t === 2) { l = (tag >> 2) + 1; off = src[p] | (src[p + 1] << 8); p += 2; }
        else { l = (tag >> 2) + 1; off = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24); p += 4; }
        if (!off || off > o) throw new Error('bad snappy offset');
        for (let i = 0; i < l; i++, o++) out[o] = out[o - off];
      }
    }
    return out;
  }
  function decompress(buf) {
    const parts = []; let p = 0, n = 0;
    while (p + 4 <= buf.length) {
      const len = buf[p + 1] | (buf[p + 2] << 8) | (buf[p + 3] << 16);
      const chunk = buf.subarray(p + 4, p + 4 + len);
      const d = buf[p] === 0 ? snappy(chunk) : chunk;
      parts.push(d); n += d.length; p += 4 + len;
    }
    const out = new Uint8Array(n); let o = 0;
    for (const q of parts) { out.set(q, o); o += q.length; }
    return out;
  }
  function pb(buf) {
    const f = []; let p = 0;
    const vr = () => { let r = 0, m = 1, b; do { if (p >= buf.length) throw new Error('eof'); b = buf[p++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; };
    while (p < buf.length) {
      const key = vr(), no = Math.floor(key / 8), wt = key & 7; let v;
      if (no === 0) throw new Error('field 0');
      if (wt === 0) v = vr();
      else if (wt === 1) { v = buf.subarray(p, p + 8); p += 8; }
      else if (wt === 2) { const l = vr(); if (p + l > buf.length) throw new Error('len'); v = buf.subarray(p, p + l); p += l; }
      else if (wt === 5) { v = buf.subarray(p, p + 4); p += 4; }
      else throw new Error('wiretype ' + wt);
      if (p > buf.length) throw new Error('eof');
      f.push([no, wt, v]);
    }
    return f;
  }
  const get = (f, no) => { const x = f.find(q => q[0] === no); return x ? x[2] : undefined; };
  const all = (f, no) => f.filter(q => q[0] === no).map(q => q[2]);
  const tryPb = b => { try { return pb(b); } catch { return null; } };
  const refOf = b => { const f = tryPb(b); return f ? get(f, 1) : undefined; };

  function messages(data) {
    const msgs = []; let p = 0;
    const vr = () => { let r = 0, m = 1, b; do { b = data[p++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; };
    while (p < data.length) {
      const l = vr(), ai = pb(data.subarray(p, p + l)); p += l;
      const id = get(ai, 1);
      for (const mi of all(ai, 2)) {
        const f = pb(mi), type = get(f, 1), len = get(f, 3) || 0;
        msgs.push({ id, type, data: data.subarray(p, p + len) }); p += len;
      }
    }
    return msgs;
  }

  async function open(zip) {
    const ctx = { zip, msgs: new Map(), fileOf: new Map(), files: {}, data: new Map() };
    for (const name of Object.keys(zip.files)) {
      const m = name.match(/(^|\/)Index\/(.+)\.iwa$/);
      if (m) {
        try {
          const list = messages(decompress(await zip.file(name).async('uint8array')));
          ctx.files[m[2]] = list;
          for (const x of list) { ctx.msgs.set(x.id, x); ctx.fileOf.set(x.id, m[2]); }
        } catch (e) { console.warn('iwa', name, e); }
      }
      const d = name.match(/(^|\/)Data\/.+-(\d+)\.[^.\/]+$/);
      if (d) ctx.data.set(+d[2], name);
    }
    return ctx;
  }

  // collect {1: n} style references anywhere inside a message
  function refs(buf, out, depth) {
    const f = tryPb(buf); if (!f) return;
    if (f.length >= 1 && f[0][0] === 1 && f[0][1] === 0 && f.length <= 2) out.push(f[0][2]);
    if (depth > 6) return;
    for (const [, wt, v] of f) if (wt === 2 && v.length > 1) refs(v, out, depth + 1);
  }
  function dataSize(ctx, id) { const e = ctx.zip.file(ctx.data.get(id)); return (e && e._data && e._data.uncompressedSize) || 0; }
  function findImage(ctx, startId) {
    const seen = new Set([startId]); let queue = [startId], found = [];
    for (let depth = 0; depth < 5 && queue.length && !found.length; depth++) {
      const next = [];
      for (const id of queue) {
        const m = ctx.msgs.get(id); if (!m) continue;
        const r = []; refs(m.data, r, 0);
        for (const n of r) {
          if (ctx.data.has(n)) found.push(n);
          else if (ctx.msgs.has(n) && !seen.has(n)) { seen.add(n); next.push(n); }
        }
      }
      queue = next;
    }
    if (!found.length) return null;
    found.sort((a, b) => dataSize(ctx, b) - dataSize(ctx, a));
    return ctx.data.get(found[0]);
  }
  function table(f, no) {
    const t = get(f, no); if (!t) return [];
    const tf = tryPb(t); if (!tf) return [];
    return all(tf, 1).map(e => { const ef = tryPb(e) || []; const r = get(ef, 2); return [get(ef, 1) || 0, r ? refOf(r) : undefined]; });
  }
  function styleOf(ctx, id) {
    const m = ctx.msgs.get(id); if (!m) return '';
    const f = tryPb(m.data); const sup = f && get(f, 1); const sf = sup && tryPb(sup);
    if (!sf) return '';
    const n = get(sf, 1), ident = get(sf, 2);
    return ((n instanceof Uint8Array ? td.decode(n) : '') + ' ' + (ident instanceof Uint8Array ? td.decode(ident) : '')).toLowerCase();
  }
  function blockType(style) {
    if (/subtitle|paantra/.test(style)) return 'h2';
    if (/title|antrašt|pavadin/.test(style)) return 'h1';
    if (/subheading|heading ?[2-6]|heading[2-6]/.test(style)) return 'h3';
    if (/heading/.test(style)) return 'h2';
    if (/caption|attribution|footnote/.test(style)) return 'cap';
    if (/quote/.test(style)) return 'quote';
    return 'p';
  }

  // Turn a TSWP.StorageArchive into blocks [{t, text} | {t:'img', path} | {t:'hr'}]
  function storageBlocks(ctx, m) {
    const f = pb(m.data);
    const text = all(f, 3).map(b => td.decode(b)).join('');
    const paras = table(f, 5), atts = new Map(table(f, 9));
    const styleCache = new Map();
    const styleAt = i => { let id; for (const [ci, r] of paras) { if (ci > i) break; if (r !== undefined) id = r; } if (id === undefined) return ''; if (!styleCache.has(id)) styleCache.set(id, styleOf(ctx, id)); return styleCache.get(id); };
    const blocks = []; let start = 0;
    const flush = (end) => {
      let seg = text.slice(start, end), pos = start;
      const style = styleAt(start), t = blockType(style);
      let buf = '';
      for (let i = 0; i < seg.length; i++) {
        const ch = seg[i], ci = pos + i;
        if (ch === '￼') {
          const target = atts.get(ci); const img = target !== undefined ? findImage(ctx, target) : null;
          if (img) { if (buf.trim()) blocks.push({ t, text: buf }); buf = ''; blocks.push({ t: 'img', path: img }); }
        } else if (ch === '\f' || ch === '\u0004' || ch === '\u0005') { if (buf.trim()) blocks.push({ t, text: buf }); buf = ''; blocks.push({ t: 'hr' }); }
        else if (ch === ' ') buf += '\n';
        else if (ch >= ' ' || ch === '\t') buf += ch;
      }
      if (buf.trim()) blocks.push({ t, text: buf });
    };
    for (let i = 0; i <= text.length; i++) if (i === text.length || text[i] === '\n' || text[i] === ' ') { flush(i); start = i + 1; }
    // tidy: no leading/trailing/double rules
    return blocks.filter((b, i, a) => !(b.t === 'hr' && (i === 0 || i === a.length - 1 || a[i - 1].t === 'hr')));
  }

  async function readPages(zip) {
    const ctx = await open(zip);
    const st = [...ctx.msgs.values()].filter(m => m.type === 2001);
    const kindOf = m => { const f = tryPb(m.data); return f ? get(f, 1) : undefined; };
    const body = st.filter(m => kindOf(m) === 0 && ctx.fileOf.get(m.id) === 'Document');
    const main = body.length ? body : st.filter(m => kindOf(m) === 0);
    let blocks = [];
    for (const m of main) blocks = blocks.concat(storageBlocks(ctx, m));
    // free text boxes (kind 3) that are not empty
    const boxes = st.filter(m => kindOf(m) === 3);
    for (const m of boxes) { const b = storageBlocks(ctx, m); if (b.some(x => x.text && x.text.trim())) blocks = blocks.concat([{ t: 'hr' }], b); }
    return { blocks, ctx };
  }

  async function readKeynote(zip) {
    const ctx = await open(zip);
    let order = [];
    const show = [...ctx.msgs.values()].find(m => m.type === 2);
    if (show) {
      const tree = get(tryPb(show.data) || [], 3);
      const tf = tree && tryPb(tree);
      if (tf) order = all(tf, 2).map(refOf).filter(x => x !== undefined);
    }
    const slides = [];
    for (const nodeId of order) {
      const node = ctx.msgs.get(nodeId); if (!node) continue;
      const nf = tryPb(node.data) || [];
      const slideRef = get(nf, 2), thumbRef = get(nf, 16);
      const slideId = slideRef ? refOf(slideRef) : undefined;
      const thumbId = thumbRef ? refOf(thumbRef) : undefined;
      if (get(nf, 4) === 1) continue; // skipped slide
      slides.push({ slideId, thumb: thumbId !== undefined ? ctx.data.get(thumbId) : null, file: ctx.fileOf.get(slideId) });
    }
    if (!slides.length) for (const f of Object.keys(ctx.files).filter(n => /^Slide/.test(n)).sort()) slides.push({ file: f, thumb: null });
    for (const s of slides) {
      s.blocks = [];
      for (const m of (ctx.files[s.file] || []).filter(x => x.type === 2001)) {
        const b = storageBlocks(ctx, m).filter(x => x.t !== 'img' && x.t !== 'hr');
        if (b.length) s.blocks.push(b);
      }
    }
    return { slides, ctx };
  }

  window.iWork = { readPages, readKeynote };
})();
