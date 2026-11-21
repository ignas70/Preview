// Automated check run inside Preview via PREVIEW_EVAL: form filling and password-protected PDFs.
setTimeout(async () => {
  const log = m => mark(m);
  try {
    await ensurePdfLib();
    // ---- 1. a PDF with form fields ----
    const d = await PDFLib.PDFDocument.create();
    const page = d.addPage([595, 842]);
    const form = d.getForm();
    const tf = form.createTextField('name'); tf.addToPage(page, { x: 50, y: 700, width: 220, height: 22 });
    const cb = form.createCheckBox('agree'); cb.addToPage(page, { x: 50, y: 660, width: 16, height: 16 });
    const rg = form.createRadioGroup('size'); rg.addOptionToPage('S', page, { x: 50, y: 620, width: 16, height: 16 }); rg.addOptionToPage('M', page, { x: 90, y: 620, width: 16, height: 16 });
    const dd = form.createDropdown('city'); dd.addOptions(['Vilnius', 'Kaunas']); dd.addToPage(page, { x: 50, y: 570, width: 140, height: 22 });
    await loadFiles([new File([await d.save()], 'form.pdf', { type: 'application/pdf' })], false);
    await new Promise(r => setTimeout(r, 1500));
    const q = s => document.querySelector(s);
    log('form widgets=' + document.querySelectorAll('.ff').length);
    const name = q('.ff[data-field$="|name"]'); name.value = 'Jonas Ąžuolaitis'; name.dispatchEvent(new Event('input'));
    q('.ff[data-field$="|agree"]').click();
    const radios = [...document.querySelectorAll('.ff[data-field$="|size"]')];
    log('radio values=' + radios.map(x => x.dataset.button).join(','));
    radios[1].click();
    const city = q('.ff[data-field$="|city"]'); city.value = 'Kaunas'; city.dispatchEvent(new Event('change'));
    let res = await buildPdf(S.pages);
    let check = await pdfjsLib.getDocument({ data: res.bytes.slice() }).promise;
    const back = (await PDFLib.PDFDocument.load(res.bytes)).getForm();
    log('saved form: name=' + back.getTextField('name').getText() + ' agree=' + back.getCheckBox('agree').isChecked() + ' size=' + back.getRadioGroup('size').getSelected() + ' city=' + back.getDropdown('city').getSelected());
    log('changed=' + [...S.formChanged].join(','));
    // extracting (copy path) flattens the values into the page
    res = await buildPdf(S.pages.slice(0, 1).concat([]), {});
    // ---- 2. password-protected PDF ----
    const p = await PDFLib.PDFDocument.create();
    const pg = p.addPage([595, 842]); pg.drawText('Secret page', { x: 50, y: 760, size: 24 });
    p.encrypt({ userPassword: 'abc', ownerPassword: 'owner123' });
    const enc = await p.save();
    dirty = false;
    const opening = loadFiles([new File([enc], 'secret.pdf', { type: 'application/pdf' })], false);
    await new Promise(r => setTimeout(r, 900));
    log('password dialog open=' + q('#pwDlg').open);
    q('#pwInput').value = 'wrong'; q('#pwOk').click();
    await new Promise(r => setTimeout(r, 700));
    log('after wrong password: dialog open=' + q('#pwDlg').open + ' message="' + q('#pwMsg').textContent + '"');
    q('#pwInput').value = 'abc'; q('#pwOk').click();
    await opening;
    log('protected file opened: pages=' + S.pages.length);
    S.pages[0].annots.push({ id: nid(), type: 'text', x: 60, y: 120, text: 'Signed', size: 16, color: '#000000', rot: 0 });
    res = await buildPdf(S.pages);
    check = await pdfjsLib.getDocument({ data: res.bytes.slice(), password: 'abc' }).promise;
    const tc = await (await check.getPage(1)).getTextContent();
    log('saved protected: text=' + tc.items.map(i => i.str).join(' | '));
  } catch (e) { log('ERR ' + e.message + ' ' + String(e.stack).split('\n')[1]); }
}, 1200);
