// Automated check run inside Preview via PREVIEW_EVAL: a styled workbook written with ExcelJS + sample files with charts.
setTimeout(async () => {
  const log = m => mark(m);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
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
    const bytes = await wb.xlsx.writeBuffer();
    await openFiles([new File([bytes], 'biudzetas.xlsx')], null); await sleep(400);
    const td = (r, c) => document.querySelector(`tr[data-r="${r}"]`).children[c + 1];
    const cs = t => { const s = getComputedStyle(t); return `bg=${s.backgroundColor} color=${s.color} weight=${s.fontWeight} size=${s.fontSize} style=${s.fontStyle} text="${t.textContent}"`; };
    log('title: ' + cs(td(0, 0)) + ' colspan=' + td(0, 0).colSpan);
    log('header: ' + cs(td(1, 1)) + ' borderBottom=' + getComputedStyle(td(1, 1)).borderBottomWidth);
    log('tinted cell: ' + cs(td(3, 2)));
    for (const f of ['WithChart.xlsx', 'styles.xlsx', 'ExcelPivotTableSample.xlsx']) {
      await openPath('C:\\Dev\\Preview\\testfiles\\excel\\' + f); await sleep(500);
      const svg = document.querySelector('.xlDrawing svg');
      log(f + ': styled cells=' + document.querySelectorAll('td[style]').length + ' charts=' + document.querySelectorAll('.xlDrawing:not(.pic)').length +
        (svg ? ' shapes=' + svg.querySelectorAll('rect,path,circle').length + ' title="' + ((svg.querySelector('text') || {}).textContent || '') + '"' : '') + ' pics=' + document.querySelectorAll('.xlDrawing.pic').length);
    }
  } catch (e) { log('ERR ' + e.message + ' ' + String(e.stack).split('\n')[1]); }
}, 1200);
