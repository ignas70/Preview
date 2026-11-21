// Automated check run inside Preview via PREVIEW_EVAL: real PDF comments, notes, flattening, redo.
setTimeout(async () => {
  const log = m => mark(m);
  try {
    setNight(false);
    const p = S.pages[0];
    p.annots.push({ id: nid(), type: 'text', x: 60, y: 60, text: 'Pastaba – ąčęėįšųūž', size: 14, color: '#c00000', rot: 0 });
    p.annots.push({ id: nid(), type: 'rect', kind: 'highlight', x: 100, y: 120, w: 300, h: 30, color: '#ffd400', opacity: 0.45 });
    p.annots.push({ id: nid(), type: 'ink', points: [[80, 300], [140, 340], [200, 300]], color: '#0050c8', width: 2 });
    p.annots.push({ id: nid(), type: 'note', x: 450, y: 60, text: 'Patikrinti šį skyrių', color: '#ffd400' });
    p.annots.push({ id: nid(), type: 'rect', kind: 'whiteout', x: 60, y: 700, w: 200, h: 40, color: '#ffffff', opacity: 1 });
    renderAnnots(p);
    // undo / redo
    pushUndo(); p.annots.pop(); renderAnnots(p);
    undo(); const afterUndo = S.pages[0].annots.length; redo(); const afterRedo = S.pages[0].annots.length;
    log(`undo/redo: after undo ${afterUndo} annotations, after redo ${afterRedo}`);
    undo();
    const res = await buildPdf(S.pages);
    const doc = await pdfjsLib.getDocument({ data: res.bytes.slice() }).promise;
    const an = await (await doc.getPage(1)).getAnnotations();
    log('saved comments: ' + an.map(a => a.subtype + (a.contentsObj && a.contentsObj.str ? '("' + a.contentsObj.str + '")' : '')).join(', '));
    // render the saved page and check the comments are visible (appearance streams)
    const pg = await doc.getPage(1), v = pg.getViewport({ scale: 1 }), c = document.createElement('canvas');
    c.width = v.width; c.height = v.height; const x = c.getContext('2d');
    await pg.render({ canvasContext: x, viewport: v }).promise;
    const px = (X, Y) => [...x.getImageData(X, Y, 1, 1).data.slice(0, 3)].join(',');
    log(`rendered: highlight=${px(250, 135)} ink=${px(140, 340)} note=${px(460, 72)}`);
    const flat = await buildPdf(S.pages, { flatten: true });
    const fdoc = await pdfjsLib.getDocument({ data: flat.bytes.slice() }).promise;
    const fan = await (await fdoc.getPage(1)).getAnnotations();
    log('flattened copy comments: ' + fan.filter(a => a.subtype !== 'Link').length);
  } catch (e) { log('ERR ' + e.message + ' ' + String(e.stack).split('\n')[1]); }
}, 1800);
