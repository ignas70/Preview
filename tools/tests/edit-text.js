// open: tracemonkey.pdf
// Editing the PDF's own text and quick stamps; the saved file is read back.
test(async () => {
  setNight(false); setEditing(true); await sleep(300);
  const p = S.pages[0], lines = await textLines(p), r = p.el.getBoundingClientRect();
  const clickOn = l => editTextAt({ clientX: r.left + (l.x + 5) * S.zoom, clientY: r.top + (l.base - l.size * 0.3) * S.zoom, preventDefault() { } }, p);
  const retype = (a, text) => { const c = p.el.querySelector(`.annot[data-id='${a.id}'] .content`); c.textContent = text; c.dispatchEvent(new Event('input')); c.blur(); };
  check('lines of text are found', lines.length > 50, lines.length);
  const title = lines[0];
  check('title font recognised as bold serif', title.fam === 'serif' && title.bold, title.fontName);
  setTool('edittext');
  await clickOn(title); await sleep(200);
  const a = p.annots.find(x => x.type === 'edit');
  check('clicking a line starts editing it', a && a.orig === title.str, a && a.orig);
  check('colours sampled from the page', a && a.bg === '#ffffff' && a.color === '#000000', a && a.bg + ' ' + a.color);
  const uni = 'ąčęšž';
  retype(a, 'Pakeistas tekstas ' + uni);
  const l2 = lines.find(x => x !== title && x.str.length > 20);
  await clickOn(l2);
  retype(p.annots.filter(x => x.type === 'edit')[1], 'Second line edited');
  check('both edits kept', p.annots.filter(x => x.type === 'edit').length === 2);
  await clickOn(lines[1]); await sleep(100);
  document.activeElement.blur();
  check('an edit left unchanged is dropped', p.annots.filter(x => x.type === 'edit').length === 2);

  Profile.set({ name: 'Jonas Jonaitis', asked: true });
  const labels = stampItems().filter(x => x !== '-').map(x => x.label);
  check('stamp menu offers date, name, initials', labels.includes(todayStr()) && labels.includes('Jonas Jonaitis') && labels.includes('J. J.'), labels.join(' | '));
  startStamp(todayStr()); placeStamp(p, { x: 400, y: 700 });
  startStamp('J. J.'); placeStamp(p, { x: 400, y: 730 });
  check('stamp tool returns to Select', S.tool === 'select');
  selectAnnot(null);

  const res = await buildPdf(S.pages);
  const doc = await pdfjsLib.getDocument({ data: res.bytes.slice(), worker: pdfWorker }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map(i => i.str).join('').replace(/\s+/g, '');
  check('edited text is in the saved page', text.includes('Pakeistastekstas' + uni), text.slice(0, 60));
  check('second edit is in the saved page', text.includes('Secondlineedited'));
  const notes = (await page.getAnnotations()).map(x => x.contentsObj && x.contentsObj.str);
  check('stamps saved', notes.includes(todayStr()) && notes.includes('J. J.'), notes.join(' | '));
  Profile.set({});
});
