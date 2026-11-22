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
});
