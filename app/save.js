'use strict';
/* Preview – building the saved PDF: page content, real comments, picture compression. */

/* ---------- saving ---------- */
async function rasterize(p) {
  const v = vp(p, 2), c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await pdfPage(p).render({ canvasContext: ctx, viewport: v }).promise;
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}
async function buildPdf(pages, opts = {}) {
  await Promise.all([ensurePdfLib(), allPagesReady()]);
  const { PDFDocument, degrees, LineCapStyle, BlendMode } = PDFLib;
  const lib = new Map(); let rasterized = false;
  for (const id of new Set(pages.map(p => p.docId))) {
    let ld = null;
    const opts = { updateMetadata: false, parseSpeed: PDFLib.ParseSpeeds.Fastest };
    try { ld = await PDFDocument.load(await docBytes(id), opts); }
    catch (e) {
      // protected PDFs: decrypted with the password typed when opening (empty for restriction-only files)
      try { ld = await PDFDocument.load(await docBytes(id), { ...opts, password: S.docs.get(id).password || '' }); } catch (e2) { console.warn(e, e2); }
    }
    if (ld && !ld.isEncrypted) { ld.registerFontkit(fontkit); ld._formFilled = await applyForm(ld, id); }
    lib.set(id, ld && !ld.isEncrypted ? ld : null);
  }
  const copied = new Map();
  let out;
  const onlyId = lib.size === 1 ? [...lib.keys()][0] : null, base = onlyId != null ? lib.get(onlyId) : null;
  if (base && pages.length === base.getPageCount() && pages.every((p, i) => p.idx === i)) {
    // Whole document in its original order: edit it in place (keeps the file structure and size).
    out = base;
    const orig = out.getPages();
    pages.forEach((p, i) => copied.set(p.key, orig[i]));
  } else {
    out = await PDFDocument.create();
    for (const [id, ld] of lib) {
      if (!ld) continue;
      const ps = pages.filter(p => p.docId === id);
      if (ld._formFilled) { try { ld.getForm().flatten(); } catch (e) { console.warn('flatten', e); } }   // filled values become page content in the new file
      const cps = await out.copyPages(ld, ps.map(p => p.idx));
      ps.forEach((p, i) => copied.set(p.key, cps[i]));
    }
  }
  out.registerFontkit(fontkit);
  let font = null;
  if (pages.some(p => S.ocr.has(ocrKey(p)) || p.annots.some(a => (a.type === 'text' || a.type === 'note' || a.type === 'edit') && (a.text || '').trim()))) {
    await ensureFont(); if (!fontBytes) throw new Error('Font not loaded');
    font = await out.embedFont(fontBytes, { subset: true });
  }
  const imgCache = new Map();
  const getImg = async id => {
    if (!imgCache.has(id)) { const d = images.get(id).dataUrl; const b = dataUrlBytes(d); imgCache.set(id, d.startsWith('data:image/png') ? await out.embedPng(b) : await out.embedJpg(b)); }
    return imgCache.get(id);
  };
  for (const p of pages) {
    const v1 = vp(p, 1); let pg, conv, R;
    if (copied.has(p.key)) {
      pg = copied.get(p.key); if (out !== base) out.addPage(pg); R = rotOf(p); pg.setRotation(degrees(R));
      conv = (x, y) => v1.convertToPdfPoint(x, y);
      drawOcrText(pg, p, font);   // recognised text of scanned pages, invisible but searchable
    } else { // encrypted / broken source: keep page as image
      rasterized = true;
      const img = await out.embedJpg(await rasterize(p));
      pg = out.addPage([v1.width, v1.height]); pg.drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
      R = 0; conv = (x, y) => [x, v1.height - y];
    }
    for (const a of p.annots) {
      // text, highlights, drawings and notes become real PDF comments (editable in other apps);
      // white-out and signatures/images are always burned into the page
      if (a.type === 'edit') { await drawEdit(out, pg, a, conv, R, font); continue; }   // edited text is always part of the page
      if (!opts.flatten && writeAnnot(out, pg, a, conv, R, font)) continue;
      const rot = a.rot || 0;
      if (a.type === 'note') { drawNoteFlat(pg, a, conv, font); continue; }
      if (a.type === 'text' && a.text.trim()) {
        a.text.replace(/\t/g, '    ').split('\n').forEach((line, i) => {
          if (!line) return;
          const [lx, ly] = rotv(0, (baseRatio + i * 1.2) * a.size, rot);
          const [x, y] = conv(a.x + lx, a.y + ly);
          pg.drawText(line, { x, y, size: a.size, font, color: hexRgb(a.color), rotate: degrees(R - rot) });
        });
      } else if (a.type === 'image') {
        const [lx, ly] = rotv(0, a.h, rot);
        const [x, y] = conv(a.x + lx, a.y + ly);
        pg.drawImage(await getImg(a.imgId), { x, y, width: a.w, height: a.h, rotate: degrees(R - rot) });
      } else if (a.type === 'rect') {
        const c1 = conv(a.x, a.y), c2 = conv(a.x + a.w, a.y + a.h);
        const o = { x: Math.min(c1[0], c2[0]), y: Math.min(c1[1], c2[1]), width: Math.abs(c2[0] - c1[0]), height: Math.abs(c2[1] - c1[1]), color: hexRgb(a.color), opacity: a.opacity, borderWidth: 0 };
        if (a.kind === 'highlight' && BlendMode) o.blendMode = BlendMode.Multiply;
        pg.drawRectangle(o);
      } else if (a.type === 'ink') {
        const pts = a.points.map(([x, y]) => conv(x, y)), col = hexRgb(a.color);
        for (let i = 1; i < pts.length; i++)
          pg.drawLine({ start: { x: pts[i - 1][0], y: pts[i - 1][1] }, end: { x: pts[i][0], y: pts[i][1] }, thickness: a.width, color: col, lineCap: LineCapStyle.Round });
      }
    }
  }
  let compressed = null;
  if (opts.compress) compressed = await compressDoc(out);
  return { bytes: await out.save({ objectsPerTick: Infinity }), rasterized, compressed };
}
async function save(pages = S.pages, suffix = '-edited', opts = {}) {
  if (!pages.length) { toast('Nothing to save'); return; }
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  busy(opts.compress ? 'Compressing…' : 'Saving PDF…');
  let res;
  try { res = await buildPdf(pages, opts); }
  catch (e) { console.error(e); busy(false); toast('Could not create the PDF: ' + e.message, 5000); return; }
  busy(false);
  const name = S.fileName + suffix + '.pdf';
  const saved = await downloadFile(res.bytes, name);
  if (!saved) return;
  if (pages === S.pages) { dirty = false; updateUI(); }
  const shown = typeof saved === 'string' ? saved.split(/[\\/]/).pop() : name;
  const extra = res.compressed ? (res.compressed.count ? ` · ${res.compressed.count} pictures recompressed, ${(res.compressed.saved / 1048576).toFixed(1)} MB smaller` : ' · nothing left to compress') : '';
  toast((res.rasterized ? 'Saved. Pages of the protected PDF were saved as images.' : `Saved ${shown}`) + extra, 4500);
}
const PDF_FILE = { label: 'PDF document', ext: 'pdf', mime: 'application/pdf' };
const MD_FILE = { label: 'Markdown document', ext: 'md', mime: 'text/markdown' };
async function downloadFile(bytes, name, type = PDF_FILE) {
  if (host) {
    const r = await hostCall('saveAs', { name, dir: Cur.path ? dirOf(Cur.path) : '', data: toB64(bytes), filter: `${type.label}|*.${type.ext}` });
    if (r.error) { toast('Could not save: ' + r.error, 5000); return false; }
    return r.path || false;
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: type.label, accept: { [type.mime]: ['.' + type.ext] } }] });
      const w = await h.createWritable(); await w.write(bytes); await w.close(); return true;
    } catch (e) { if (e.name === 'AbortError') return false; console.warn(e); }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function exportMarkdown() {
  if (!S.pages.length) return;
  busy('Converting to Markdown…');
  let md;
  try { await loadLib('pdf2md.js'); md = await pdfMarkdown(S.pages); }
  catch (e) { console.error(e); toast('Could not convert: ' + e.message, 5000); return; }
  finally { busy(false); }
  if (!md.trim()) { toast('This PDF has no text to export. Scanned pages need Recognize text (OCR) first.', 5000); return; }
  const saved = await downloadFile(new TextEncoder().encode(md), S.fileName + '.md', MD_FILE);
  if (saved) toast('Saved ' + (typeof saved === 'string' ? saved.split(/[\\/]/).pop() : S.fileName + '.md'), 4500);
}


/* ================= real PDF comments (annotations with appearance streams) ================= */
// Returns true when `a` was written as an annotation; false means "draw it into the page instead".
function writeAnnot(out, pg, a, conv, R, font) {
  const L = PDFLib, ctx = out.context, N = n => L.PDFName.of(n);
  const rgbOf = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const bounds = pts => { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const add = (subtype, rect, extra, ops, resources) => {
    const ap = ctx.register(ctx.formXObject(ops, { BBox: rect, Resources: resources || {} }));
    const dict = ctx.obj({
      Type: 'Annot', Subtype: subtype, Rect: rect, F: 4,
      NM: L.PDFString.of('preview-' + a.id + '-' + Date.now().toString(36)),
      M: L.PDFString.fromDate(new Date()), T: L.PDFHexString.fromText('Preview'),
      AP: { N: ap }, ...extra,
    });
    pg.node.addAnnot(ctx.register(dict));
    return true;
  };
  if (a.type === 'rect' && a.kind === 'highlight') {
    const [x1, y1, x2, y2] = bounds([conv(a.x, a.y), conv(a.x + a.w, a.y + a.h)]);
    const [r, g, b] = rgbOf(a.color);
    return add('Highlight', [x1, y1, x2, y2], { C: [r, g, b], CA: a.opacity, QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1] },
      [L.pushGraphicsState(), L.setGraphicsState('GS0'), L.setFillingRgbColor(r, g, b), L.rectangle(x1, y1, x2 - x1, y2 - y1), L.fill(), L.popGraphicsState()],
      { ExtGState: { GS0: { Type: 'ExtGState', ca: a.opacity, CA: a.opacity, BM: 'Multiply' } } });
  }
  if (a.type === 'ink' && a.points.length > 1) {
    const pts = a.points.map(([x, y]) => conv(x, y)), [r, g, b] = rgbOf(a.color), w = a.width;
    const [x1, y1, x2, y2] = bounds(pts), rect = [x1 - w, y1 - w, x2 + w, y2 + w];
    const ops = [L.pushGraphicsState(), L.setStrokingRgbColor(r, g, b), L.setLineWidth(w), L.setLineCap(L.LineCapStyle.Round), L.setLineJoin(L.LineJoinStyle.Round), L.moveTo(pts[0][0], pts[0][1])];
    for (let i = 1; i < pts.length; i++) ops.push(L.lineTo(pts[i][0], pts[i][1]));
    ops.push(L.stroke(), L.popGraphicsState());
    return add('Ink', rect, { C: [r, g, b], BS: { W: w, S: 'S' }, InkList: [pts.flat()] }, ops);
  }
  if (a.type === 'text' && a.text.trim() && font) {
    const lines = a.text.replace(/\t/g, '    ').split('\n'), size = a.size, rot = a.rot || 0;
    const w = Math.max(...lines.map(l => font.widthOfTextAtSize(l, size))) + 2, h = lines.length * size * 1.2;
    const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([u, v]) => { const [dx, dy] = rotv(u, v, rot); return conv(a.x + dx, a.y + dy); });
    const rect = bounds(corners), [r, g, b] = rgbOf(a.color);
    const th = (R - rot) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const ops = [L.pushGraphicsState(), L.beginText(), L.setFontAndSize('F1', size), L.setFillingRgbColor(r, g, b)];
    lines.forEach((line, i) => {
      if (!line) return;
      const [lx, ly] = rotv(0, (baseRatio + i * 1.2) * size, rot), [x, y] = conv(a.x + lx, a.y + ly);
      ops.push(L.setTextMatrix(c, s, -s, c, x, y), L.showText(font.encodeText(line)));
    });
    ops.push(L.endText(), L.popGraphicsState());
    return add('FreeText', rect, {
      Contents: L.PDFHexString.fromText(a.text), DA: L.PDFString.of(`/Helv ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`),
      BS: { W: 0 }, Rotate: ((R - rot) % 360 + 360) % 360,
    }, ops, { Font: { F1: font.ref } });
  }
  if (a.type === 'note') {
    const [x, y] = conv(a.x, a.y + 20), s = 20, rect = [x, y, x + s, y + s], [r, g, b] = rgbOf(a.color || '#ffd400');
    const ops = [L.pushGraphicsState(), L.setFillingRgbColor(r, g, b), L.setStrokingRgbColor(r * 0.6, g * 0.6, b * 0.3), L.setLineWidth(0.8),
      L.rectangle(x + 1, y + 4, s - 2, s - 5), L.fillAndStroke(),
      L.moveTo(x + 5, y + 4.5), L.lineTo(x + 5, y + 0.5), L.lineTo(x + 9, y + 4.5), L.fillAndStroke(),
      L.setStrokingRgbColor(0.35, 0.3, 0.1), L.moveTo(x + 4, y + 14), L.lineTo(x + s - 4, y + 14), L.moveTo(x + 4, y + 10.5), L.lineTo(x + s - 4, y + 10.5), L.moveTo(x + 4, y + 7), L.lineTo(x + s - 8, y + 7), L.stroke(),
      L.popGraphicsState()];
    return add('Text', rect, { Contents: L.PDFHexString.fromText(a.text || ''), Name: 'Comment', C: [r, g, b], Open: false }, ops);
  }
  return false;
}
// Flattened copy: a note becomes a small yellow box with its text.
function drawNoteFlat(pg, a, conv, font) {
  const [x, y] = conv(a.x, a.y + 20);
  pg.drawRectangle({ x, y, width: 18, height: 18, color: PDFLib.rgb(1, 0.83, 0), borderColor: PDFLib.rgb(0.6, 0.5, 0), borderWidth: 0.8 });
  if (font && (a.text || '').trim()) a.text.split('\n').forEach((line, i) => line && pg.drawText(line, { x: x + 22, y: y + 12 - i * 11, size: 9, font, color: PDFLib.rgb(0.2, 0.2, 0.2) }));
}


/* ================= compression ================= */
// Re-encodes large JPEG pictures inside the PDF (max 2000 px, quality 72). Text and vector content are untouched.
async function compressDoc(out) {
  const { PDFName, PDFRawStream, PDFNumber, PDFArray } = PDFLib;
  const N = s => PDFName.of(s);
  let before = 0, after = 0, count = 0;
  for (const [ref, obj] of out.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(N('Subtype')) !== N('Image')) continue;
    let filter = dict.get(N('Filter'));
    if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.get(0) : null;
    if (filter !== N('DCTDecode') || dict.get(N('Decode'))) continue;
    let cs = dict.get(N('ColorSpace'));
    if (cs instanceof PDFArray && cs.get(0) === N('ICCBased')) {
      const icc = out.context.lookup(cs.get(1)); const n = icc && icc.dict && icc.dict.get(N('N'));
      cs = n && n.asNumber && n.asNumber() === 3 ? N('DeviceRGB') : null;
    }
    if (cs !== N('DeviceRGB') && cs !== N('DeviceGray')) continue;
    const bytes = obj.contents;
    if (bytes.length < 40000) continue;
    let bmp; try { bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })); } catch { continue; }
    const hasMask = !!dict.get(N('SMask')) || !!dict.get(N('Mask'));
    const k = hasMask ? 1 : Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const W = Math.max(1, Math.round(bmp.width * k)), H = Math.max(1, Math.round(bmp.height * k));
    const c = new OffscreenCanvas(W, H); const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(bmp, 0, 0, W, H); bmp.close && bmp.close();
    const nb = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.72 })).arrayBuffer());
    if (nb.length > bytes.length * 0.9) continue;
    const nd = dict.clone(out.context);
    nd.set(N('Width'), PDFNumber.of(W)); nd.set(N('Height'), PDFNumber.of(H));
    nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('BitsPerComponent'), PDFNumber.of(8));
    nd.set(N('Filter'), N('DCTDecode')); nd.delete(N('DecodeParms'));
    out.context.assign(ref, PDFRawStream.of(nd, nb));
    before += bytes.length; after += nb.length; count++;
  }
  return { count, saved: before - after };
}
