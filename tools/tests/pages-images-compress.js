// Images to PDF, inserting a blank page, compressing pictures.
test(async () => {
  const photo = async (w, h, type) => {   // a noisy "photo" so JPEG compression has something to do
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2b6fd6'); g.addColorStop(1, '#e2703a'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    const id = x.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() * 40) | 0; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } x.putImageData(id, 0, 0);
    return new File([await c.convertToBlob({ type, quality: 0.98 })], 'photo.' + (type === 'image/png' ? 'png' : 'jpg'), { type });
  };
  await openImages([await photo(1600, 1200, 'image/jpeg'), await photo(800, 1100, 'image/png')], null);
  await sleep(800);
  check('two images become a 2-page PDF', S.pages.length === 2, S.pages.length);
  const sizes = S.pages.map(p => { const v = vp(p, 1); return v.width > v.height ? 'landscape' : 'portrait'; });
  check('each page follows its picture shape', sizes.join(',') === 'landscape,portrait', sizes.join(','));
  S.sel = new Set([S.pages[0].key]);
  await insertBlankPage();
  check('blank page inserted after the selected page', S.pages.length === 3 && S.docs.get(S.pages[1].docId).name !== S.docs.get(S.pages[0].docId).name, S.pages.map(p => S.docs.get(p.docId).name).join(','));

  await ensurePdfLib();
  const d = await PDFLib.PDFDocument.create();
  const img = await d.embedJpg(new Uint8Array(await (await photo(4000, 3000, 'image/jpeg')).arrayBuffer()));
  d.addPage([800, 600]).drawImage(img, { x: 0, y: 0, width: 800, height: 600 });
  const src = await d.save();
  dirty = false;
  await loadFiles([new File([src], 'photo.pdf', { type: 'application/pdf' })], false);
  const plain = await buildPdf(S.pages), small = await buildPdf(S.pages, { compress: true });
  check('compressed copy is much smaller', small.bytes.length < plain.bytes.length * 0.6, (plain.bytes.length / 1e6).toFixed(2) + ' MB -> ' + (small.bytes.length / 1e6).toFixed(2) + ' MB');
  check('one picture was recompressed', small.compressed.count === 1, small.compressed.count);
  const chk = await pdfjsLib.getDocument({ data: small.bytes.slice() }).promise;
  const c = document.createElement('canvas'), pg = await chk.getPage(1), v = pg.getViewport({ scale: 0.25 }); c.width = v.width; c.height = v.height;
  await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
  const px = c.getContext('2d').getImageData(10, 10, 1, 1).data;
  check('compressed page still shows the picture', px[2] > px[0], [...px.slice(0, 3)].join(','));
});
