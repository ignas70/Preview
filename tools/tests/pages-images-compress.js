// Automated check run inside Preview via PREVIEW_EVAL: blank page, images -> PDF, compression.
setTimeout(async () => {
  const log = m => mark(m);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const photo = async (w, h, type) => {   // a noisy "photo" so JPEG compression has something to do
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2b6fd6'); g.addColorStop(1, '#e2703a'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    const id = x.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() * 40) | 0; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } x.putImageData(id, 0, 0);
    return new File([await c.convertToBlob({ type, quality: 0.98 })], 'photo.' + (type === 'image/png' ? 'png' : 'jpg'), { type });
  };
  try {
    // images -> PDF
    await openImages([await photo(1600, 1200, 'image/jpeg'), await photo(800, 1100, 'image/png')], null);
    await sleep(800);
    log('images->pdf pages=' + S.pages.length + ' sizes=' + S.pages.map(p => { const v = vp(p, 1); return Math.round(v.width) + 'x' + Math.round(v.height); }).join(',') + ' dirty=' + dirty + ' editing=' + document.body.classList.contains('editing'));
    // blank page after the first
    S.sel = new Set([S.pages[0].key]);
    await insertBlankPage();
    log('after blank page: pages=' + S.pages.length + ' order=' + S.pages.map(p => S.docs.get(p.docId).name).join(','));
    // compression: a PDF with a big high-quality JPEG
    await ensurePdfLib();
    const d = await PDFLib.PDFDocument.create();
    const big = new Uint8Array(await (await photo(4000, 3000, 'image/jpeg')).arrayBuffer());
    const img = await d.embedJpg(big); const pg = d.addPage([800, 600]); pg.drawImage(img, { x: 0, y: 0, width: 800, height: 600 });
    const src = await d.save();
    dirty = false;
    await loadFiles([new File([src], 'photo.pdf', { type: 'application/pdf' })], false);
    const plain = await buildPdf(S.pages), small = await buildPdf(S.pages, { compress: true });
    log('compress: original=' + (src.length / 1e6).toFixed(2) + 'MB plain=' + (plain.bytes.length / 1e6).toFixed(2) + 'MB compressed=' + (small.bytes.length / 1e6).toFixed(2) + 'MB pictures=' + small.compressed.count);
    const chk = await pdfjsLib.getDocument({ data: small.bytes.slice() }).promise;
    const c = document.createElement('canvas'); const v = (await chk.getPage(1)).getViewport({ scale: 0.25 }); c.width = v.width; c.height = v.height;
    await (await chk.getPage(1)).render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
    const px = c.getContext('2d').getImageData(10, 10, 1, 1).data;
    log('compressed page renders, corner pixel=' + px.slice(0, 3).join(','));
  } catch (e) { log('ERR ' + e.message + ' ' + String(e.stack).split('\n')[1]); }
}, 1200);
