'use strict';
/* Preview – electronic signatures, display: the signers card list for containers, the banner and
   details dialog for signed PDFs. The checks themselves are in esign-verify.js. */

function signerName(r) {
  const s = (r.cert && r.cert.subject) || {};
  const name = s.GN && s.SN ? s.GN + ' ' + s.SN : (s.CN || r.nameHint || 'Unknown signer').replace(/,\d{6,}$/, '').replace(/,/g, ' ');
  return name.replace(/\b([A-ZĄČĘĖĮŠŲŪŽÄÖÜÕ])([A-ZĄČĘĖĮŠŲŪŽÄÖÜÕ]+)\b/g, (m, a, b) => a + b.toLowerCase());
}
function personalCode(r) { const sn = r.cert && r.cert.subject && r.cert.subject.serialNumber; if (!sn) return ''; const m = /^(?:PNO|IDC|PAS)[A-Z]{2}-(.+)$/.exec(sn); return m ? m[1] : sn; }
function sigStatus(r) {
  if (r.docsOk === false) return ['bad', 'Document changed after signing'];
  if (r.sigOk === false) return ['bad', 'Signature does not match'];
  if (r.docsOk && r.sigOk && r.trust === 'self-made') return ['unknown', 'Intact, but the signer made their own certificate – the name is not confirmed'];
  if (r.docsOk && r.sigOk) return ['ok', 'Signature valid'];
  return ['unknown', 'Could not be fully checked'];
}
const fmtTime = d => d && !isNaN(d) ? d.toLocaleString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'time unknown';
function sigCard(r) {
  const [cls, label] = sigStatus(r), c = el('div', 'sigCard ' + cls);
  const icon = el('span', 'sigIcon g'); icon.textContent = cls === 'ok' ? '' : cls === 'bad' ? '' : '';
  const body = el('div', 'sigBody');
  const h = el('div', 'sigName'); h.textContent = r.isTimestamp ? 'Document time-stamp – ' + signerName(r) : signerName(r); body.append(h);
  const meta = el('div', 'sigMeta');
  const code = personalCode(r);
  meta.textContent = [fmtTime(r.time), code && 'personal code ' + code, r.place, r.role, r.reason].filter(Boolean).join(' · ');
  body.append(meta);
  const st = el('div', 'sigState'); st.textContent = (r.isTimestamp ? label.replace('Signature', 'Time-stamp') : label) + (r.level && r.level.length ? ' · ' + r.level.join(', ') : '');
  body.append(st);
  const iss = r.cert && r.cert.issuer && (r.cert.issuer.CN || r.cert.issuer.O);
  if (iss) { const i2 = el('div', 'sigMeta'); i2.textContent = 'Certificate issued by ' + iss + (r.cert.issuer.C ? ' (' + r.cert.issuer.C + ')' : '') + (r.trust === 'test' ? ' – a test certificate, not a real signature' : ''); body.append(i2); }
  for (const p of r.problems || []) { const pe = el('div', 'sigProblem'); pe.textContent = p; body.append(pe); }
  if (r.coversAll === false && !r.isTimestamp) { const pe = el('div', 'sigMeta'); pe.textContent = 'More was added to the PDF after this signature (e.g. further signatures or form filling).'; body.append(pe); }
  c.append(icon, body);
  return c;
}
const SIG_NOTE = 'Checked on this PC: the documents are unchanged since signing and each signature matches its certificate. Whether the certificate was trusted and not revoked at the time is not checked online.';

// signature containers open in the document view
async function renderContainer(f, inner) {
  const res = await readContainer(await f.arrayBuffer());
  inner.className = '';
  const box = el('div', 'esign');
  const head = el('div', 'esHead');
  const unsigned = res.docs.filter(d => !d.signed).length;
  const okAll = res.sigs.length && res.sigs.every(s => sigStatus(s)[0] === 'ok') && !unsigned;
  head.innerHTML = `<span class="g">${okAll ? '' : ''}</span><div><b></b><span></span></div>`;
  head.querySelector('b').textContent = !res.sigs.length ? 'No signatures in this container'
    : `${res.sigs.length} signature${res.sigs.length > 1 ? 's' : ''}` + (okAll ? ' – all valid' : unsigned ? ` – ${unsigned} file${unsigned > 1 ? 's are' : ' is'} not signed` : '');
  head.querySelector(':scope > div > span').textContent = SIG_NOTE;
  if (okAll) head.classList.add('ok');
  box.append(head);
  for (const s of res.sigs) box.append(sigCard(s));
  const dh = el('h3'); dh.textContent = 'Documents'; box.append(dh);
  for (const d of res.docs) {
    const row = el('button', 'esDoc' + (d.signed ? '' : ' unsigned'));
    row.append(badgeFor(extOf(d.name)));
    const n = el('span', 'rn'); n.textContent = d.name.split('/').pop(); row.append(n);
    if (!d.signed) { const w = el('span', 'esWarn'); w.textContent = 'not signed'; row.append(w); }
    const sz = el('span', 'rp'); sz.textContent = (d.bytes.length / 1024).toFixed(0) + ' KB'; row.append(sz);
    const go = el('span', 'esOpen'); go.textContent = 'View'; row.append(go);
    row.addEventListener('click', () => openFromContainer(f, d, res));
    box.append(row);
  }
  inner.append(box);
}
async function openFromContainer(f, d, res) {
  const name = d.name.split('/').pop();
  Cur.pendingContainer = { name: f.name, sigs: d.signed ? res.sigs : [], file: f, path: Cur.path };
  await openFiles([new File([d.bytes], name, { type: extOf(name) === 'pdf' ? 'application/pdf' : '' })], null);
}
function showContainerBanner() {
  const fc = Cur.fromContainer; if (!fc) return;
  const ok = fc.sigs.length && fc.sigs.every(s => sigStatus(s)[0] === 'ok');
  const b = $(document.body.dataset.mode === 'pdf' ? '#pdfSigBanner' : '#docSigBanner');
  b.className = 'sigBanner' + (ok ? ' ok' : ' bad');
  b.innerHTML = `<span class="g">${ok ? '' : ''}</span><span class="sbText"></span><button class="sbBack">Back to signatures</button>`;
  b.querySelector('.sbText').textContent = fc.sigs.length ? `From "${fc.name}" · signed by ${fc.sigs.map(signerName).join(', ')}${ok ? ' · valid' : ''}` : `From "${fc.name}" · this file is not signed`;
  b.querySelector('.sbBack').onclick = () => { if (fc.path) openPath(fc.path); else openFiles([fc.file], null); };
  b.hidden = false;
}

// signatures inside a PDF: banner + details
const AFTER_TEXT = { changes: 'the PDF was changed after the last signature', unknown: 'later additions to the PDF could not be checked' };
async function checkPdfSignatures() {
  const banner = $('#pdfSigBanner'); banner.hidden = true; S.pdfSigs = [];
  if (Cur.fromContainer) { showContainerBanner(); return; }
  const first = S.docs.size ? [...S.docs.keys()][0] : null; if (first == null) return;
  const doc = S.docs.get(first);
  let sigs = [];
  try { sigs = await pdfSignatures(doc.pdf, () => docBytes(first)); } catch (e) { console.warn('pdf signatures', e); }
  if (S.docs.get(first) !== doc) return;   // another file was opened meanwhile
  S.pdfSigs = sigs;
  if (!sigs.length) return;
  const later = AFTER_TEXT[sigs.after];
  const ok = !later && sigs.every(s => sigStatus(s)[0] === 'ok');
  banner.className = 'sigBanner' + (ok ? ' ok' : sigs.some(s => sigStatus(s)[0] === 'bad') || sigs.after === 'changes' ? ' bad' : '');
  banner.innerHTML = `<span class="g">${ok ? '' : ''}</span><span class="sbText"></span><button class="sbBack">Details</button>`;
  const who = [...new Set(sigs.filter(s => !s.isTimestamp).map(signerName))].join(', ') || 'a time-stamp only';
  const notOk = sigs.find(s => sigStatus(s)[0] !== 'ok');
  banner.querySelector('.sbText').textContent = `Digitally signed by ${who} · ` + (notOk ? sigStatus(notOk)[1].toLowerCase() : later || 'signature' + (sigs.length > 1 ? 's' : '') + ' valid');
  banner.querySelector('.sbBack').onclick = () => {
    const d = $('#sigDlg'), list = d.querySelector('.sigList'); list.textContent = '';
    for (const s of sigs) list.append(sigCard(s));
    d.querySelector('.sigNote').textContent = (later ? 'Note: ' + later + '. ' : '') + SIG_NOTE; d.showModal();
  };
  banner.hidden = false;
}
