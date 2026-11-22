// Start screen and the document viewers not covered elsewhere: Word, PowerPoint, Pages, Keynote, Google links.
test(async () => {
  check('start screen is shown', document.body.dataset.mode === 'home');
  check('settings show the version', /Version \d+\.\d+\.\d+/.test(document.querySelector('#updInfo').textContent), document.querySelector('#updInfo').textContent);
  const opened = async (f, sel, min) => {
    await openPath(TESTFILES + f); await sleep(1500);
    const n = document.querySelectorAll(sel).length;
    check(f + ' is displayed', !document.querySelector('.msgCard') && n >= min, n);
  };
  await opened('test.docx', '.docx-wrapper section', 1);
  await opened('test.pptx', '#docInner .pptx-preview-slide-wrapper, #docInner [class*=slide]', 1);
  await opened('iwork\\modern_novel.pages', '.iwDoc > *', 3);
  await opened('iwork\\with_content.key', '.kSlide', 1);
  check('Keynote can be presented', !document.querySelector('#docPresent').hidden);
  await openFiles([new File(['{"url": "https://docs.google.com/document/d/abc/edit", "doc_id": "abc"}'], 'notes.gdoc')], null); await sleep(800);
  check('Google link shows a card instead of failing silently', !!document.querySelector('#docInner .msgCard, #docInner .gCard, #docInner iframe'), document.querySelector('#docInner').textContent.slice(0, 80));
  setMode('home'); await sleep(100);
  check('recent files listed on the start screen', document.querySelectorAll('#recent button').length > 0);
});
