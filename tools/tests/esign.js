// E-signature containers and signed PDFs: signers, verification, opening the signed documents.
test(async () => {
  const dir = TESTFILES + 'esign\\';
  const containers = { 'valid-asice.asice': 1, 'latvian_signed_container.asice': 1, '2_signatures_duplicate_id.asice': 2, '23608_bdoc21-no-nonce-policy.bdoc': 1, 'DigiDocService_spec_est.pdf-TM-j.bdoc': 1 };
  for (const [f, n] of Object.entries(containers)) {
    await openPath(dir + f); await sleep(600);
    const cards = [...document.querySelectorAll('.sigCard')];
    check(f + ': all signatures valid', cards.length === n && cards.every(c => c.classList.contains('ok')), cards.map(c => c.className).join(','));
    check(f + ': signer name shown', cards.length > 0 && cards[0].querySelector('.sigName').textContent.length > 3, cards[0] && cards[0].querySelector('.sigName').textContent);
    check(f + ': header names the count', /signature/.test(document.querySelector('.esHead b').textContent), document.querySelector('.esHead b').textContent);
  }
  // a container's documents open with a banner leading back
  check('container lists its 2 documents', document.querySelectorAll('.esDoc').length === 2);
  document.querySelectorAll('.esDoc')[1].click(); await sleep(2500);
  const back = document.querySelector('#pdfSigBanner');
  check('inner PDF opens with a signature banner', document.body.dataset.mode === 'pdf' && !back.hidden && back.textContent.includes('Männik'), back.textContent);
  back.querySelector('button').click(); await sleep(800);
  check('"Back to signatures" returns to the container', document.querySelectorAll('.sigCard').length === 1);

  // signed PDFs (from the EU DSS test set)
  const pdfs = { 'Signature-P-HU_MIC-1.pdf': 'valid', 'Signature-P-DE_SCI-4.pdf': 'valid', 'PAdES-LT.pdf': 'valid', 'DSS-2025.pdf': 'empty' };
  for (const [f, want] of Object.entries(pdfs)) {
    await openPath(dir + 'pdf\\' + f); await sleep(2500);
    const sigs = S.pdfSigs || [], banner = document.querySelector('#pdfSigBanner');
    if (want === 'valid') check(f + ': signatures and time-stamps valid', sigs.length > 0 && sigs.every(s => s.docsOk && s.sigOk), sigs.map(s => s.problems.join(';')).join(' | '));
    else check(f + ': empty signature reported', sigs.length === 1 && /empty/.test(sigs[0].problems.join(' ')), sigs.map(s => s.problems.join(';')).join(' | '));
    check(f + ': banner shown', !banner.hidden, banner.textContent);
  }
  await openPath(dir + 'pdf\\PAdES-LT.pdf'); await sleep(2500);
  check('time-stamps are not listed as signers', !document.querySelector('#pdfSigBanner').textContent.includes('Tsa'), document.querySelector('#pdfSigBanner').textContent);
  await openPath(TESTFILES + 'tracemonkey.pdf'); await sleep(2500);
  check('PDF without signatures shows no banner', document.querySelector('#pdfSigBanner').hidden);
});
