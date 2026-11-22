// A styled workbook written with ExcelJS, then sample files with charts and pictures.
test(async () => {
  await loadLib('lib/exceljs.min.js');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Biudžetas');
  ws.columns = [{ width: 24 }, { width: 12 }, { width: 12 }];
  ws.addRow(['Išlaidos 2026', null, null]); ws.mergeCells('A1:C1');
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1F4E79' } };
  ws.addRow(['Kategorija', 'Planas', 'Faktas']);
  ws.getRow(2).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }; c.border = { bottom: { style: 'medium', color: { argb: 'FF1F4E79' } } }; });
  [['Nuoma', 800, 800], ['Maistas', 400, 455.5], ['Transportas', 120, 98]].forEach(r => ws.addRow(r));
  ws.getCell('C4').fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 5, tint: 0.6 } };
  ws.getCell('C4').font = { italic: true, color: { argb: 'FFC00000' } };
  ['B', 'C'].forEach(col => { for (let r = 3; r <= 5; r++) ws.getCell(col + r).numFmt = '#,##0.00 "€"'; });
  await openFiles([new File([await wb.xlsx.writeBuffer()], 'biudzetas.xlsx')], null); await sleep(400);
  const td = (r, c) => document.querySelector(`tr[data-r="${r}"]`).children[c + 1];
  const st = t => getComputedStyle(t);
  check('merged bold title', td(0, 0).colSpan === 3 && +st(td(0, 0)).fontWeight >= 700, td(0, 0).colSpan + ' ' + st(td(0, 0)).fontWeight);
  check('header fill and white text', st(td(1, 1)).backgroundColor === 'rgb(68, 114, 196)' && st(td(1, 1)).color === 'rgb(255, 255, 255)', st(td(1, 1)).backgroundColor);
  check('header has a thick (medium) bottom border', parseFloat(st(td(1, 1)).borderBottomWidth) > 1, st(td(1, 1)).borderBottomWidth);
  check('italic red cell with theme tint', st(td(3, 2)).fontStyle === 'italic' && st(td(3, 2)).color === 'rgb(192, 0, 0)' && st(td(3, 2)).backgroundColor !== 'rgba(0, 0, 0, 0)', st(td(3, 2)).backgroundColor);
  check('number format with euro sign', /455[,.]50\s*€/.test(td(3, 2).textContent), td(3, 2).textContent);
  for (const f of ['styles.xlsx', 'ExcelPivotTableSample.xlsx']) {
    await openPath(TESTFILES + 'excel\\' + f); await sleep(500);
    check(f + ' opens with styled cells', !document.querySelector('.msgCard') && document.querySelectorAll('td[style]').length > 0, document.querySelectorAll('td[style]').length);
  }
  await openPath(TESTFILES + 'excel\\WithChart.xlsx'); await sleep(500);   // the chart is on the second sheet
  document.querySelectorAll('.sheetTabs button')[1].click(); await sleep(500);
  check('WithChart.xlsx shows its chart on sheet 2', !!document.querySelector('.xlDrawing svg'));
});
