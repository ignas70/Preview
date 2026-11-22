// Signature verification on its own (no display): good containers pass, a tampered one fails.
test(async () => {
  await loadLib('lib/jszip.min.js');
  const read = async f => new Uint8Array(await (await fetch(fileUrl(TESTFILES + 'esign\\' + f))).arrayBuffer());
  const good = await readContainer(await read('valid-asice.asice'));
  check('signed file listed', good.docs.length === 1 && good.docs[0].name === 'test.txt', good.docs.map(d => d.name).join(','));
  check('signature verifies', good.sigs.length === 1 && good.sigs[0].docsOk && good.sigs[0].sigOk, good.sigs.map(s => s.problems.join(';')).join(' | '));
  check('signer certificate read', good.sigs[0].cert.subject.serialNumber.includes('11404176865'), good.sigs[0].cert.subject.serialNumber);
  check('signing time read', good.sigs[0].time instanceof Date && good.sigs[0].time.getUTCFullYear() === 2018, String(good.sigs[0].time));

  // change one byte of the signed document inside the container
  const zip = await JSZip.loadAsync(await read('valid-asice.asice'));
  const txt = await zip.file('test.txt').async('uint8array'); txt[0] ^= 1; zip.file('test.txt', txt);
  const bad = await readContainer(await zip.generateAsync({ type: 'uint8array' }));
  check('changed document is detected', bad.sigs[0].docsOk === false && bad.sigs[0].problems.some(p => /changed after signing/.test(p)), bad.sigs[0].problems.join(';'));

  // change the signature value: the signature check must fail, the document check still passes
  const z2 = await JSZip.loadAsync(await read('valid-asice.asice'));
  const xml = await z2.file('META-INF/signatures0.xml').async('string');
  z2.file('META-INF/signatures0.xml', xml.replace(/(<ds:SignatureValue[^>]*>)(.)/, (m, a, c) => a + (c === 'A' ? 'B' : 'A')));
  const forged = await readContainer(await z2.generateAsync({ type: 'uint8array' }));
  check('forged signature value is detected', forged.sigs[0].sigOk === false, String(forged.sigs[0].sigOk));

  // a file added to the container after signing is not shown as signed
  const z3 = await JSZip.loadAsync(await read('valid-asice.asice'));
  z3.file('invoice.pdf', 'added later');
  const added = await readContainer(await z3.generateAsync({ type: 'uint8array' }));
  const inv = added.docs.find(d => d.name === 'invoice.pdf'), orig = added.docs.find(d => d.name === 'test.txt');
  check('file added after signing is marked unsigned', inv && inv.signed === false && orig.signed === true);

  // certificates that prove nothing about the name
  const cert = (issuer, subject) => ({ issuer, subject });
  check('self-made certificate is recognised', certTrustNote(cert({ CN: 'Jonas', C: 'LT' }, { CN: 'Jonas', C: 'LT' })) === 'self-made');
  check('test certificate is recognised', certTrustNote(good.sigs[0].cert) === 'test', good.sigs[0].cert.issuer.CN);
  check('a self-made certificate is not shown as valid', sigStatus({ docsOk: true, sigOk: true, trust: 'self-made' })[0] !== 'ok');

  // what was appended to a PDF after its last signature
  const pdfTail = s => { const head = new Uint8Array(100); const t = new TextEncoder().encode(s); const b = new Uint8Array(100 + t.length); b.set(head); b.set(t, 100); return changesAfter(b, 100); };
  check('nothing appended', changesAfter(new Uint8Array(100), 100) === 'none');
  check('only validation data appended', pdfTail('5 0 obj << /Type /Catalog /Pages 2 0 R /DSS 9 0 R >> endobj 9 0 obj << /Certs [10 0 R] /OCSPs [11 0 R] >> endobj') === 'validation');
  check('changed page appended', pdfTail('3 0 obj << /Type /Page /Contents 12 0 R >> endobj') === 'changes');
  check('changed form value appended', pdfTail('7 0 obj << /FT /Tx /V (new value) >> endobj') === 'changes');
});
