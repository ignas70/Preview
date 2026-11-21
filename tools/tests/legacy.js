// Automated check run inside Preview via PREVIEW_EVAL: older / open formats.
setTimeout(async () => {
  const log = m => mark(m);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const dir = 'C:\\Dev\\Preview\\testfiles\\legacy\\';
  const summary = () => {
    const blocks = [...document.querySelectorAll('.iwDoc > *, .kSlide .txt')].map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return `items=${blocks.length} slides=${document.querySelectorAll('.kSlide').length} imgs=${document.querySelectorAll('#docInner img').length} err=${!!document.querySelector('.msgCard h2')} first="${(blocks[0] || document.querySelector('.msgCard p')?.textContent || '').slice(0, 70)}"`;
  };
  try {
    for (const f of ['SampleDoc.doc', 'Lists.doc', 'basic_test_ppt_file.ppt', 'with_textbox.ppt']) {
      await openPath(dir + f); await sleep(300); log(f + ': ' + summary());
    }
    const rtf = '{\\rtf1\\ansi\\ansicpg1257\\deff0{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0\\fs24 Labas, \\u260?\\u382?mon\\\'eb!\\par Antra eilut\\\'eb su \\b pary\\\'f0kintu\\b0  tekstu.\\par}';
    await openFiles([new File([rtf], 'test.rtf')], null); await sleep(300); log('test.rtf: ' + summary());
    await loadLib('lib/jszip.min.js');
    const content = (body) => `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:body>${body}</office:body></office:document-content>`;
    let z = new JSZip(); z.file('mimetype', 'application/vnd.oasis.opendocument.text');
    z.file('content.xml', content('<office:text><text:h text:outline-level="1">Ataskaita</text:h><text:p>Pirma<text:s text:c="2"/>pastraipa su ąčę.</text:p><text:list><text:list-item><text:p>Punktas A</text:p></text:list-item></text:list><table:table><table:table-row><table:table-cell><text:p>X</text:p></table:table-cell><table:table-cell><text:p>Y</text:p></table:table-cell></table:table-row></table:table></office:text>'));
    await openFiles([new File([await z.generateAsync({ type: 'uint8array' })], 'test.odt')], null); await sleep(300); log('test.odt: ' + summary());
    z = new JSZip(); z.file('mimetype', 'application/vnd.oasis.opendocument.presentation');
    z.file('content.xml', content('<office:presentation><draw:page><draw:frame presentation:class="title"><draw:text-box><text:p>Pirma skaidrė</text:p></draw:text-box></draw:frame><draw:frame presentation:class="outline"><draw:text-box><text:p>Taškas 1</text:p><text:p>Taškas 2</text:p></draw:text-box></draw:frame></draw:page><draw:page><draw:frame presentation:class="title"><draw:text-box><text:p>Antra</text:p></draw:text-box></draw:frame></draw:page></office:presentation>'));
    await openFiles([new File([await z.generateAsync({ type: 'uint8array' })], 'test.odp')], null); await sleep(300); log('test.odp: ' + summary());
  } catch (e) { log('ERR ' + e.message + ' ' + String(e.stack).split('\n')[1]); }
}, 1200);
