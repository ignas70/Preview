// open: tracemonkey.pdf
// Sticky notes: icon only on the page, text on hover, small editor while editing.
test(async () => {
  setNight(false);
  const p = S.pages[0], pop = () => document.querySelector('#notePop'), notes = () => p.annots.filter(a => a.type === 'note');
  const clickElsewhere = () => document.querySelector('#viewer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  setEditing(true);
  addNote(p, { x: 300, y: 200 }); await sleep(150);
  check('a new note opens its editor', !!(pop() && !pop().hidden && pop().classList.contains('edit')));
  const ta = pop().querySelector('textarea'); ta.value = 'Patikrinti sumą su buhalterija'; ta.dispatchEvent(new Event('input'));
  clickElsewhere(); await sleep(100);
  check('clicking elsewhere closes the editor and keeps the text', pop().hidden && notes().length === 1 && notes()[0].text === 'Patikrinti sumą su buhalterija');
  addNote(p, { x: 400, y: 400 }); await sleep(150);
  clickElsewhere(); await sleep(100);
  check('an empty note is removed', notes().length === 1, notes().length);
  setEditing(false); renderAnnots(p); await sleep(100);
  const icon = p.el.querySelector('.annot.note');
  check('in View mode only a small icon is shown', icon && icon.getBoundingClientRect().width < 30 && pop().hidden);
  icon.dispatchEvent(new PointerEvent('pointerenter')); await sleep(100);
  check('hovering shows the note text', !pop().hidden && pop().textContent.includes('buhalterija'), pop().textContent);
}, 1500);
