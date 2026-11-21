'use strict';
/* Preview – text recognition (OCR) for scanned PDFs, fully offline (Tesseract, Lithuanian + English).
   Recognised words become selectable/searchable, and are saved as an invisible text layer. */

S.ocr = new Map();   // "docId:idx" -> [{ text, rect:[x1,y1,x2,y2], base:[x,y], size, angle }] in PDF user space
const ocrKey = p => p.docId + ':' + p.idx;
const OCR = { worker: null, running: false, cancel: false };

async function ocrWorker() {
  if (OCR.worker) return OCR.worker;
  await loadLib('lib/ocr/tesseract.min.js');
  const base = new URL('lib/ocr/', location.href).href;
  OCR.worker = await Tesseract.createWorker(['lit', 'eng'], 1, {
    workerPath: base + 'worker.min.js', corePath: base, langPath: base.replace(/\/$/, ''),
    gzip: true, cacheMethod: 'none', workerBlobURL: false,
  });
  return OCR.worker;
}

// A page needs OCR when it has (almost) no real text.
async function pageHasText(p) {
  const pg = await realPage(p);
  pg._tc = pg._tc || await pg.getTextContent();
  return pg._tc.items.reduce((n, it) => n + (it.str || '').trim().length, 0) > 15;
}
async function suggestOcr() {
  const sample = S.pages.slice(0, 3);
  if (!sample.length || sample.some(p => S.ocr.has(ocrKey(p)))) return;
  for (const p of sample) if (await pageHasText(p).catch(() => true)) return;
  toastAction('This looks like a scanned document – its text can\'t be searched or copied yet.', 'Recognize text', () => runOcr(), 12000);
}

async function runOcr(pages) {
  if (OCR.running) return;
  pages = pages || S.pages;
  const todo = [];
  for (const p of pages) if (!S.ocr.has(ocrKey(p)) && !(await pageHasText(p).catch(() => false))) todo.push(p);
  if (!todo.length) { toast('All pages already have text'); return; }
  OCR.running = true; OCR.cancel = false;
  const bar = $('#ocrBar'), label = $('#ocrLabel'); bar.hidden = false;
  label.textContent = 'Preparing text recognition…';
  let done = 0;
  try {
    const w = await ocrWorker();
    for (const p of todo) {
      if (OCR.cancel) break;
      label.textContent = `Recognizing text… page ${S.pages.indexOf(p) + 1} (${done + 1} of ${todo.length})`;
      const pg = await realPage(p), R = rotOf(p);
      const v1 = pg.getViewport({ scale: 1, rotation: R });
      const scale = Math.min(3, 2400 / Math.max(v1.width, v1.height));   // ~250 dpi for A4
      const v = pg.getViewport({ scale, rotation: R });
      const c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: v }).promise;
      const { data } = await w.recognize(c);
      const words = [];
      for (const wd of data.words || []) {
        const text = (wd.text || '').trim();
        if (!text || wd.confidence < 25) continue;
        const b = wd.bbox, bl = wd.baseline || {};
        const p1 = v.convertToPdfPoint(b.x0, b.y0), p2 = v.convertToPdfPoint(b.x1, b.y1);
        const by = bl.y0 != null && bl.y0 > b.y0 && bl.y0 <= b.y1 + 2 ? bl.y0 : b.y0 + (b.y1 - b.y0) * 0.8;
        words.push({ text, rect: [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])],
          base: v.convertToPdfPoint(b.x0, by), size: Math.max(2, (b.y1 - b.y0) / scale * 0.92), w: (b.x1 - b.x0) / scale, angle: R });
      }
      S.ocr.set(ocrKey(p), words);
      delete pg._txt;
      p.extrasFor = null; if (visible.has(p.key)) pageExtras(p);
      done++;
    }
  } catch (e) { console.error(e); toast('Text recognition failed: ' + e.message, 5000); }
  finally {
    OCR.running = false; bar.hidden = true;
    if (OCR.worker) { OCR.worker.terminate().catch(() => { }); OCR.worker = null; }
  }
  if (done) {
    dirty = true; updateUI();
    if (Find.q) runFind(Find.q);
    toast(`Text recognized on ${done} page${done > 1 ? 's' : ''} – you can now search and copy it. Save to keep it.`, 5000);
  }
}
$('#ocrCancel').addEventListener('click', () => { OCR.cancel = true; $('#ocrLabel').textContent = 'Stopping…'; });

/* ---- text layer and search for recognised pages ---- */
const measureCtx = document.createElement('canvas').getContext('2d');
function ocrTextLayer(p, tl, v) {
  const words = S.ocr.get(ocrKey(p)); if (!words) return;
  tl.textContent = '';
  for (const w of words) {
    const r = rectOf(v, w.rect), span = el('span');
    const fs = Math.max(4, r.h * 0.86);
    measureCtx.font = `${fs}px sans-serif`;
    const natural = measureCtx.measureText(w.text).width || 1;
    span.textContent = w.text + ' ';
    Object.assign(span.style, { left: r.x + 'px', top: r.y + 'px', fontSize: fs + 'px', fontFamily: 'sans-serif', transform: `scaleX(${(r.w / natural).toFixed(3)})` });
    tl.append(span);
  }
}
// pageText() equivalent for recognised pages: one item per word
function ocrPageText(p) {
  const words = S.ocr.get(ocrKey(p)); if (!words) return null;
  let s = ''; const starts = [], items = [];
  for (const w of words) { starts.push(s.length); s += w.text + ' '; items.push({ str: w.text + ' ', ocrRect: w.rect }); }
  return { s, n: fold(s), starts, items };
}

/* ---- invisible text when saving (keeps the PDF searchable everywhere) ---- */
function drawOcrText(pg, p, font) {
  const words = S.ocr.get(ocrKey(p)); if (!words || !font) return;
  for (const w of words) {
    const unit = font.widthOfTextAtSize(w.text, 1) || 1;
    const size = Math.max(1, Math.min(w.size, w.w / unit));
    try { pg.drawText(w.text, { x: w.base[0], y: w.base[1], size, font, opacity: 0, rotate: PDFLib.degrees(w.angle || 0) }); } catch { }
  }
}
