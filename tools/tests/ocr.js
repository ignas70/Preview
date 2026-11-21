// Automated OCR check: builds an image-only ("scanned") PDF, recognises it, searches it, saves it.
setTimeout(async () => {
  const log = m => mark(m);
  try {
    setNight(false);
    await ensurePdfLib(); await ensurePdfJs();
    // page 1: a picture of a real page; page 2: Lithuanian text drawn as an image
    const src = await pdfjsLib.getDocument({ data: new Uint8Array(await (await fetch('https://file.preview/?p=' + encodeURIComponent('C:\\Dev\\Preview\\testfiles\\tracemonkey.pdf'))).arrayBuffer()) }).promise;
    const sp = await src.getPage(1), sv = sp.getViewport({ scale: 2 });
    const c1 = document.createElement('canvas'); c1.width = sv.width; c1.height = sv.height;
    await sp.render({ canvasContext: c1.getContext('2d'), viewport: sv }).promise;
    const c2 = document.createElement('canvas'); c2.width = 1240; c2.height = 1754; const x = c2.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1240, 1754); x.fillStyle = '#111'; x.font = '44px Arial';
    ['Sutartis Nr. 2026/11', 'Šalys susitarė dėl ąžuolinių baldų pristatymo.', 'Kaina: 1 250,00 € su PVM.', 'Pasirašyta Vilniuje, lapkričio 20 d.'].forEach((t, i) => x.fillText(t, 120, 200 + i * 90));
    const d = await PDFLib.PDFDocument.create();
    for (const c of [c1, c2]) {
      const jpg = await d.embedJpg(new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer()));
      const pg = d.addPage([595, 842]); pg.drawImage(jpg, { x: 0, y: 0, width: 595, height: 842 });
    }
    await loadFiles([new File([await d.save()], 'scan.pdf', { type: 'application/pdf' })], false);
    await new Promise(r => setTimeout(r, 1500));
    log('suggestion shown=' + (document.querySelector('#toast').classList.contains('withAction')) + ' text="' + document.querySelector('#toast').textContent.slice(0, 40) + '"');
    const t = performance.now();
    await runOcr();
    log(`ocr: ${Math.round(performance.now() - t)} ms, words p1=${(S.ocr.get(ocrKey(S.pages[0])) || []).length} p2=${(S.ocr.get(ocrKey(S.pages[1])) || []).length}`);
    log('page 2 text: ' + (S.ocr.get(ocrKey(S.pages[1])) || []).map(w => w.text).join(' ').slice(0, 160));
    for (const q of ['Trace-based', 'ąžuolinių', 'Vilniuje']) { await runFind(q); log(`search "${q}": ${document.querySelector('#findCount').textContent}`); }
    log('selectable spans on page 2=' + (S.pages[1].el.querySelectorAll('.textLayer span').length));
    const res = await buildPdf(S.pages);
    const chk = await pdfjsLib.getDocument({ data: res.bytes.slice() }).promise;
    const tc = await (await chk.getPage(2)).getTextContent();
    log('saved PDF page 2 text: ' + tc.items.map(i => i.str).join(' ').slice(0, 140));
  } catch (e) { log('ERR ' + e.message + ' ' + String(e.stack).split('\n')[1]); }
}, 1200);
