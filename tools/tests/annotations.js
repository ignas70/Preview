// open: tracemonkey.pdf
// Comments saved as real PDF annotations, flattening, undo/redo.
test(async () => {
  setNight(false);
  const p = S.pages[0];
  p.annots.push({ id: nid(), type: 'text', x: 60, y: 60, text: 'Pastaba – ąčęėįšųūž', size: 14, color: '#c00000', rot: 0 });
  p.annots.push({ id: nid(), type: 'rect', kind: 'highlight', x: 100, y: 120, w: 300, h: 30, color: '#ffd400', opacity: 0.45 });
  p.annots.push({ id: nid(), type: 'ink', points: [[80, 300], [140, 340], [200, 300]], color: '#0050c8', width: 2 });
  p.annots.push({ id: nid(), type: 'note', x: 450, y: 60, text: 'Patikrinti šį skyrių', color: '#ffd400' });
  p.annots.push({ id: nid(), type: 'rect', kind: 'whiteout', x: 60, y: 700, w: 200, h: 40, color: '#ffffff', opacity: 1 });
  renderAnnots(p);
  pushUndo(); p.annots.pop(); renderAnnots(p);
  undo(); const afterUndo = S.pages[0].annots.length; redo(); const afterRedo = S.pages[0].annots.length;
  check('undo brings the removed item back', afterUndo === 5, afterUndo);
  check('redo removes it again', afterRedo === 4, afterRedo);
  undo();

  const res = await buildPdf(S.pages);
  const doc = await pdfjsLib.getDocument({ data: res.bytes.slice() }).promise;
  const kinds = (await (await doc.getPage(1)).getAnnotations()).map(a => a.subtype);
  for (const k of ['FreeText', 'Highlight', 'Ink', 'Text']) check(`saved as a real ${k} comment`, kinds.includes(k), kinds.join(','));

  const pg = await doc.getPage(1), v = pg.getViewport({ scale: 1 }), c = document.createElement('canvas');
  c.width = v.width; c.height = v.height; const x = c.getContext('2d');
  await pg.render({ canvasContext: x, viewport: v }).promise;
  const px = (X, Y) => [...x.getImageData(X, Y, 1, 1).data.slice(0, 3)];
  const hl = px(250, 135), ink = px(140, 339);
  check('highlight is visible in the saved file', hl[0] > 200 && hl[1] > 180 && hl[2] < 160, hl.join(','));
  check('drawing is visible in the saved file', ink[2] > ink[0] + 40, ink.join(','));

  const flat = await buildPdf(S.pages, { flatten: true });
  const fdoc = await pdfjsLib.getDocument({ data: flat.bytes.slice() }).promise;
  const left = (await (await fdoc.getPage(1)).getAnnotations()).filter(a => a.subtype !== 'Link').length;
  check('flattened copy has no comments left', left === 0, left);
}, 1800);
