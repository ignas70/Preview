'use strict';
/* Preview – printing a PDF and full-screen presentation. */

/* ================= printing a PDF (with everything added in Preview) ================= */
async function printPdf() {
  if (!S.pages.length) return;
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  busy('Preparing to print…');
  const box = $('#printBox'), urls = [];
  try {
    const res = await buildPdf(S.pages);
    const doc = await pdfjsLib.getDocument({ data: res.bytes.slice(), worker: pdfWorker }).promise;
    box.textContent = '';
    for (let i = 1; i <= doc.numPages; i++) {
      busy(`Preparing to print… page ${i} of ${doc.numPages}`);
      const pg = await doc.getPage(i), v = pg.getViewport({ scale: 150 / 72 });   // 150 dpi
      const c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      const url = URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))); urls.push(url);
      const im = el('img', v.width > v.height ? 'land' : 'port'); im.src = url; box.append(im);
    }
    await Promise.all([...box.querySelectorAll('img')].map(im => im.decode().catch(() => { })));
    doc.destroy();
  } catch (e) { busy(false); toast('Could not prepare the document for printing: ' + e.message, 5000); return; }
  busy(false);
  document.body.classList.add('printingPdf');
  window.print();
  document.body.classList.remove('printingPdf');
  box.textContent = ''; urls.forEach(u => URL.revokeObjectURL(u));
}

/* ================= presentation mode (F5) ================= */
const Show = { on: false, i: 0, count: 0, render: null };
async function present() {
  const mode = document.body.dataset.mode;
  let nodes = null;
  if (mode === 'pdf') {
    if (!S.pages.length) return;
    Show.count = S.pages.length; Show.i = S.cur || 0;
    Show.render = async i => {
      const p = S.pages[i], pg = await realPage(p);
      const v1 = vp(p, 1), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(innerWidth / v1.width, innerHeight / v1.height);
      const v = vp(p, scale * dpr), c = document.createElement('canvas');
      c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      c.style.width = v1.width * scale + 'px'; c.style.height = v1.height * scale + 'px';
      await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: v }).promise;
      return c;
    };
  } else if (mode === 'doc') {
    nodes = [...document.querySelectorAll('.pptx-preview-slide-wrapper')];
    if (!nodes.length) nodes = [...document.querySelectorAll('.kSlide img')];
    if (!nodes.length) nodes = [...document.querySelectorAll('.kSlide')];
    if (!nodes.length) nodes = [...document.querySelectorAll('.docx-wrapper>section.docx')];
    if (!nodes.length) { toast('Nothing to present in this file'); return; }
    Show.count = nodes.length; Show.i = 0;
    Show.render = async i => {
      const src = nodes[i], w = src.offsetWidth || src.naturalWidth, h = src.offsetHeight || src.naturalHeight;
      const k = Math.min(innerWidth / w, innerHeight / h);
      const holder = el('div', 'showSlide'); holder.style.width = w * k + 'px'; holder.style.height = h * k + 'px';
      const clone = src.cloneNode(true); clone.style.transform = `scale(${k})`; clone.style.transformOrigin = '0 0'; clone.style.margin = '0';
      clone.style.width = w + 'px'; clone.style.height = h + 'px';
      holder.append(clone); return holder;
    };
  } else return;
  const ov = $('#present'); ov.hidden = false; Show.on = true;
  try { await ov.requestFullscreen(); } catch { }
  await showSlide(Show.i);
}
async function showSlide(i) {
  Show.i = Math.max(0, Math.min(Show.count - 1, i));
  const ov = $('#present'), node = await Show.render(Show.i);
  ov.querySelector('.showStage').replaceChildren(node);
  ov.querySelector('.showCount').textContent = `${Show.i + 1} / ${Show.count}`;
  if (document.body.dataset.mode === 'pdf' && S.pages[Show.i]) scrollToPage(S.pages[Show.i]);
}
function endShow() {
  if (!Show.on) return;
  Show.on = false; $('#present').hidden = true; $('#present .showStage').textContent = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) endShow(); else if (Show.on) setTimeout(() => showSlide(Show.i), 60); });
document.addEventListener('keydown', e => {
  if (!Show.on) return;
  const k = e.key;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) showSlide(Show.i + 1);
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) showSlide(Show.i - 1);
  else if (k === 'Home') showSlide(0);
  else if (k === 'End') showSlide(Show.count - 1);
  else if (k === 'Escape') endShow();
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
$('#present').addEventListener('click', e => { if (e.target.closest('.showExit')) return endShow(); showSlide(Show.i + 1); });
$('#present').addEventListener('contextmenu', e => { e.preventDefault(); showSlide(Show.i - 1); });
$('#btnPresent').addEventListener('click', present);
$('#docPresent').addEventListener('click', present);
