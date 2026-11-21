// Sticky notes: icon only on the page, text on hover, small editor while editing.
setTimeout(async () => {
  const log = m => mark(m);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    setNight(false);
    const p = S.pages[0], pop = () => document.querySelector('#notePop');
    setEditing(true);
    const r = p.el.getBoundingClientRect();
    addNote(p, { x: 300, y: 200 }); await sleep(150);
    log('new note: editor open=' + !!(pop() && !pop().hidden && pop().classList.contains('edit')));
    const ta = pop().querySelector('textarea'); ta.value = 'Patikrinti sumą su buhalterija'; ta.dispatchEvent(new Event('input'));
    document.querySelector('#viewer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));   // click elsewhere
    await sleep(100);
    log('after click elsewhere: popup hidden=' + pop().hidden + ' notes=' + p.annots.filter(a => a.type === 'note').length + ' text="' + p.annots.find(a => a.type === 'note').text + '"');
    addNote(p, { x: 400, y: 400 }); await sleep(150);
    document.querySelector('#viewer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await sleep(100);
    log('empty note removed: notes=' + p.annots.filter(a => a.type === 'note').length);
    setEditing(false); renderAnnots(p); await sleep(100);
    const icon = p.el.querySelector('.annot.note');
    log('view mode: icon ' + Math.round(icon.getBoundingClientRect().width) + 'px, card visible=' + !pop().hidden);
    icon.dispatchEvent(new PointerEvent('pointerenter'));
    await sleep(100);
    log('hover: card visible=' + !pop().hidden + ' text="' + pop().textContent + '"');
  } catch (e) { log('ERR ' + e.message + ' ' + String(e.stack).split('\n')[1]); }
}, 1500);
