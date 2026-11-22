// Builds an .xlsx with a clustered column chart and a pie chart, opens it and reports what was drawn.
test(async () => {
    await loadLib('lib/exceljs.min.js'); await loadLib('lib/jszip.min.js');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sales');
    ws.addRows([['Quarter', 'North', 'South'], ['Q1', 120, 80], ['Q2', 150, 95], ['Q3', 90, 130], ['Q4', 170, 110]]);
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const cache = (vals, num) => `<c:${num ? 'numCache' : 'strCache'}><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:${num ? 'numCache' : 'strCache'}>`;
    const ser = (i, name, vals) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>x</c:f>${cache([name])}</c:strRef></c:tx><c:cat><c:strRef><c:f>x</c:f>${cache(['Q1', 'Q2', 'Q3', 'Q4'])}</c:strRef></c:cat><c:val><c:numRef><c:f>x</c:f>${cache(vals, 1)}</c:numRef></c:val></c:ser>`;
    zip.file('xl/charts/chart1.xml', `<?xml version="1.0"?><c:chartSpace ${C}><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Sales by quarter</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${ser(0, 'North', [120, 150, 90, 170])}${ser(1, 'South', [80, 95, 130, 110])}</c:barChart></c:plotArea><c:legend/></c:chart></c:chartSpace>`);
    zip.file('xl/charts/chart2.xml', `<?xml version="1.0"?><c:chartSpace ${C}><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>North share</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:pieChart>${ser(0, 'North', [120, 150, 90, 170])}</c:pieChart></c:plotArea><c:legend/></c:chart></c:chartSpace>`);
    const anchor = (fc, fr, tc, tr, rid) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${fc}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fr}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${tc}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${tr}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><a:graphic><a:graphicData><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>`;
    zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchor(4, 0, 11, 15, 'rId1')}${anchor(4, 16, 9, 30, 'rId2')}</xdr:wsDr>`);
    zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/></Relationships>`);
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdD" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    let sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    sheet = sheet.replace('</worksheet>', '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdD"/></worksheet>');
    zip.file('xl/worksheets/sheet1.xml', sheet);
    await openFiles([new File([await zip.generateAsync({ type: 'uint8array' })], 'charts.xlsx')], null);
    await new Promise(r => setTimeout(r, 500));
    const svgs = [...document.querySelectorAll('.xlDrawing svg')];
    check('both charts are drawn', svgs.length === 2, svgs.length);
    const title = i => (svgs[i] && svgs[i].querySelector('text') || {}).textContent;
    check('column chart has its title and bars', title(0) === 'Sales by quarter' && svgs[0].querySelectorAll('rect').length >= 8, title(0) + ' rects=' + (svgs[0] && svgs[0].querySelectorAll('rect').length));
    check('pie chart has its slices', title(1) === 'North share' && svgs[1].querySelectorAll('path').length >= 4, title(1));
});
