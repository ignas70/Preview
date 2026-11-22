// OCR: builds an image-only ("scanned") PDF, recognises it, searches it and saves it.
test(async () => {
  setNight(false);
  await ensurePdfLib(); await ensurePdfJs();
  const src = await pdfjsLib.getDocument({ data: new Uint8Array(await (await fetch(fileUrl(TESTFILES + 'tracemonkey.pdf'))).arrayBuffer()) }).promise;
  const sp = await src.getPage(1), sv = sp.getViewport({ scale: 2 });
  const c1 = document.createElement('canvas'); c1.width = sv.width; c1.height = sv.height;
  await sp.render({ canvasContext: c1.getContext('2d'), viewport: sv }).promise;
  const c2 = document.createElement('canvas'); c2.width = 1240; c2.height = 1754; const x = c2.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1240, 1754); x.fillStyle = '#111'; x.font = '44px Arial';
  ['Sutartis Nr. 2026/11', 'Šalys susitarė dėl ąžuolinių baldų pristatymo.', 'Kaina: 1 250,00 € su PVM.', 'Pasirašyta Vilniuje, lapkričio 20 d.'].forEach((t, i) => x.fillText(t, 120, 200 + i * 90));
  const d = await PDFLib.PDFDocument.create();
  for (const c of [c1, c2]) {
    const jpg = await d.embedJpg(new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer()));
    d.addPage([595, 842]).drawImage(jpg, { x: 0, y: 0, width: 595, height: 842 });
  }
  await loadFiles([new File([await d.save()], 'scan.pdf', { type: 'application/pdf' })], false);
  await sleep(1500);
  check('a scanned file suggests OCR', document.querySelector('#toast').classList.contains('withAction'));
  await runOcr();
  const words = i => S.ocr.get(ocrKey(S.pages[i])) || [];
  check('page 1 words recognised', words(0).length > 100, words(0).length);
  const p2 = words(1).map(w => w.text).join(' ');
  check('Lithuanian text recognised', p2.includes('ąžuolinių') && p2.includes('Vilniuje'), p2.slice(0, 120));
  for (const q of ['Trace-based', 'ąžuolinių', 'Vilniuje']) {
    await runFind(q);
    check(`search finds "${q}"`, /[1-9]/.test(document.querySelector('#findCount').textContent), document.querySelector('#findCount').textContent);
  }
  check('recognised text can be selected', S.pages[1].el.querySelectorAll('.textLayer span').length > 5);
  const res = await buildPdf(S.pages);
  const chk = await pdfjsLib.getDocument({ data: res.bytes.slice() }).promise;
  const saved = (await (await chk.getPage(2)).getTextContent()).items.map(i => i.str).join(' ');
  check('saved PDF keeps the recognised text', saved.includes('Sutartis'), saved.slice(0, 80));
});
