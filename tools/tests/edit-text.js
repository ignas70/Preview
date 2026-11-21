// Edit existing text + stamps; save and read back the text of the new PDF.
setTimeout(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await sleep(1500);
    setNight(false); setEditing(true); await sleep(300);
    const p = S.pages[0], lines = await textLines(p);
    mark('lines on page 1: ' + lines.length + ' first: ' + lines.slice(0, 3).map(l => JSON.stringify(l.str) + ' ' + l.fontName + ' ' + l.fam + (l.bold ? ' bold' : '') + ' ' + l.size.toFixed(1)).join(' | '));
    const l = lines.find(x => x.str.length > 30) || lines[0];
    setTool('edittext');
    const r = p.el.getBoundingClientRect();
    const ev = { clientX: r.left + (l.x + 10) * S.zoom, clientY: r.top + (l.base - l.size * 0.3) * S.zoom, preventDefault() { } };
    await editTextAt(ev, p); await sleep(200);
    const a = p.annots.find(x => x.type === 'edit');
    mark('edit annot: ' + JSON.stringify({ orig: a.orig, bg: a.bg, color: a.color, fam: a.fam, bold: a.bold, size: a.size }));
    const c = p.el.querySelector(`.annot[data-id='${a.id}'] .content`);
    const uni = 'ąčęšž';
    c.textContent = 'Pakeistas tekstas ' + uni; c.dispatchEvent(new Event('input')); c.blur(); await sleep(100);
    // a second, Latin-only edit uses a standard font
    const l2 = lines.find(x => x !== l && x.str.length > 20 && x.fam === 'serif') || lines[5];
    await editTextAt({ clientX: r.left + (l2.x + 5) * S.zoom, clientY: r.top + (l2.base - l2.size * 0.3) * S.zoom, preventDefault() { } }, p);
    const a2 = p.annots.filter(x => x.type === 'edit')[1], c2 = p.el.querySelector(`.annot[data-id='${a2.id}'] .content`);
    c2.textContent = 'Second line edited'; c2.dispatchEvent(new Event('input')); c2.blur();
    mark('after blur edits=' + p.annots.filter(x => x.type === 'edit').length);
    Profile.set({ name: 'Jonas Jonaitis', asked: true });
    mark('stamp items: ' + stampItems().filter(x => x !== '-').map(x => x.label).join(' | '));
    startStamp(todayStr()); placeStamp(p, { x: 400, y: 700 });
    startStamp(initialsOf('Jonas Jonaitis')); placeStamp(p, { x: 400, y: 730 });
    selectAnnot(null); setTool('select');
    await sleep(300);
    const res = await buildPdf(S.pages);
    const doc = await pdfjsLib.getDocument({ data: res.bytes.slice(), worker: pdfWorker }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    const all = tc.items.map(i => i.str).join('').replace(/\s+/g, '');
    mark('text around: ' + all.slice(all.indexOf('Pakeistas'), all.indexOf('Pakeistas') + 30)); const an = await (await doc.getPage(1)).getAnnotations(); mark('annots: ' + an.map(x => x.subtype + ':' + (x.contentsObj && x.contentsObj.str)).join(' / '));
    mark('saved: new=' + all.includes('Pakeistastekstas') + ' unicode=' + all.includes(uni) + ' latin=' + all.includes('Secondlineedited') + ' date=' + an.some(x => x.contentsObj.str === todayStr()) + ' initials=' + an.some(x => x.contentsObj.str === 'J. J.') + ' bytes=' + res.bytes.length);
    const pg1 = await doc.getPage(1), v = pg1.getViewport({ scale: 1.6 }), cv = document.createElement('canvas'); cv.width = v.width; cv.height = v.height;
    await pg1.render({ canvasContext: cv.getContext('2d'), viewport: v }).promise;
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;width:' + innerWidth + 'px;height:auto'; document.body.append(cv);
  } catch (e) { mark('ERR ' + e.stack); }
}, 300);
