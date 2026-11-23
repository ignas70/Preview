// PDF → Markdown: headings from font size, paragraphs, lists, broken words, repeated headers and page numbers.
test(async () => {
  await ensurePdfLib(); await ensurePdfJs(); await loadLib('pdf2md.js');

  // the converter on its own, with hand-made lines
  const L = (str, base, size = 11, extra = {}) => ({ str, x: 72, base, size, w: str.length * size * 0.5, bold: false, italic: false, fam: 'sans', ...extra });
  const md0 = pdfToMarkdown([{ height: 842, lines: [L('# not a heading', 100), L('2026. Metai *su* žvaigždute_ir [skliaustais]', 160)] }]);
  check('special characters are escaped', md0 === '\\# not a heading\n\n2026\\. Metai \\*su\\* žvaigždute\\_ir \\[skliaustais\\]\n', JSON.stringify(md0));

  const col = [];
  for (let k = 0; k < 6; k++) {
    col.push(L(k ? 'left ' + k : 'Left column starts', 200 + k * 12, 9, { x: 50, w: 230 }));
    col.push(L(k ? 'right ' + k : 'right column goes on', 200 + k * 12, 9, { x: 310, w: 230 }));
  }
  const two = pdfToMarkdown([{ width: 595, height: 842, lines: col }]);
  check('two columns are read one after the other', two === 'Left column starts left 1 left 2 left 3 left 4 left 5 right column goes on right 1 right 2 right 3 right 4 right 5\n', JSON.stringify(two));
  const marks = pdfToMarkdown([{ height: 842, lines: [L('Name', 100), L('∗', 96, 6), L('Body text.', 112)] }]);
  check('tiny marks are dropped', marks === 'Name Body text.\n', JSON.stringify(marks));

  const d = await PDFLib.PDFDocument.create();
  const reg = await d.embedFont(PDFLib.StandardFonts.Helvetica), bold = await d.embedFont(PDFLib.StandardFonts.HelveticaBold), mono = await d.embedFont(PDFLib.StandardFonts.Courier);
  const pages = [];
  for (let n = 1; n <= 3; n++) {
    const pg = d.addPage([595, 842]); pages.push(pg);
    pg.drawText('ACME quarterly report', { x: 72, y: 800, size: 9, font: reg });
    pg.drawText(String(n), { x: 290, y: 40, size: 9, font: reg });
  }
  const t = (pg, s, y, size = 11, font = reg, x = 72) => pg.drawText(s, { x, y, size, font });
  t(pages[0], 'Annual Summary', 740, 24, bold);
  t(pages[0], 'This first paragraph is long enough that it was wrapped', 700);
  t(pages[0], 'onto a second line by the program that made the file.', 686);
  t(pages[0], 'Second paragraph starts after a gap.', 655);
  t(pages[0], 'Results', 610, 16, bold);
  t(pages[0], '• First item', 580);
  t(pages[0], '• Second item', 565);
  t(pages[0], '1. Numbered one', 540);
  t(pages[0], '2. Numbered two', 525);
  t(pages[0], 'A word broken across lines: infor-', 495);
  t(pages[0], 'mation stays whole.', 481);
  t(pages[1], 'const total = sum(values);', 740, 10, mono);
  t(pages[1], 'return total;', 728, 10, mono);
  t(pages[1], 'This sentence continues', 100);
  t(pages[2], 'on the next page without a break.', 740);

  await loadFiles([new File([await d.save()], 'report.pdf', { type: 'application/pdf' })], false);
  await sleep(800);
  const md = await pdfMarkdown(S.pages);
  const has = s => md.includes(s);
  check('title becomes a level-1 heading', has('# Annual Summary\n'), md.slice(0, 80));
  check('smaller heading becomes level 2', has('\n## Results\n'));
  check('wrapped lines join into one paragraph', has('This first paragraph is long enough that it was wrapped onto a second line by the program that made the file.'));
  check('paragraphs stay apart', has('the file.\n\nSecond paragraph'));
  check('bullets become a list', has('- First item\n- Second item'));
  check('numbered list kept', has('1. Numbered one\n2. Numbered two'));
  check('broken word joined', has('information stays whole.'));
  check('monospaced lines become a code block', has('```\nconst total = sum(values);\nreturn total;\n```'));
  check('paragraph continues across pages', has('This sentence continues on the next page without a break.'));
  check('repeated header and page numbers removed', !has('ACME') && !/^\d+$/m.test(md), md.match(/^.*ACME.*$|^\d+$/m)?.[0]);
  $('#btnPdfMore').click(); await sleep(100);
  check('PDF menu offers the export', [...document.querySelectorAll('button, [role=menuitem], .menu *')].some(e => e.textContent.includes('Export as Markdown')));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  await loadLib('markdown.js');
  const kinds = mdParse(md).map(b => b.t).join(',');
  check('the result reads back as Markdown', kinds === 'h,p,p,h,list,list,p,code,p', kinds);
});
