'use strict';
/* Preview – sticky notes: a small icon on the page, the text in a card on hover. */

/* ---- sticky notes: a small icon on the page; the text appears in a card on hover ---- */
const NotePop = { id: null, edit: false, hideT: 0 };
function notePopEl() {
  let pop = $('#notePop');
  if (!pop) {
    pop = el('div'); pop.id = 'notePop'; pop.hidden = true; document.body.append(pop);
    pop.addEventListener('pointerenter', () => clearTimeout(NotePop.hideT));
    pop.addEventListener('pointerleave', () => { if (!NotePop.edit) hideNotePop(); });
    pop.addEventListener('pointerdown', ev => ev.stopPropagation());
  }
  return pop;
}
// Shows the card next to `anchor`. read-only: text; edit: a text box bound to the note.
function showNotePop(anchor, text, opts = {}) {
  clearTimeout(NotePop.hideT);
  const pop = notePopEl();
  pop.className = opts.edit ? 'edit' : '';
  pop.textContent = '';
  if (opts.edit) {
    const ta = el('textarea'); ta.value = text || ''; ta.placeholder = 'Write a note…';
    ta.addEventListener('input', () => { opts.onInput(ta.value); });
    ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); opts.onClose(); } ev.stopPropagation(); });
    pop.append(ta);
    const hint = el('div', 'npHint'); hint.textContent = 'Click outside the note to close · Esc'; pop.append(hint);
    setTimeout(() => ta.focus());
  } else {
    if (opts.title) { const h = el('div', 'npTitle'); h.textContent = opts.title; pop.append(h); }
    const t = el('div', 'npText'); t.textContent = text || 'Empty note'; if (!text) t.classList.add('empty'); pop.append(t);
  }
  NotePop.id = opts.id || null; NotePop.edit = !!opts.edit;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = r.right + 8, y = r.top - 4;
  if (x + pw > innerWidth - 8) x = r.left - pw - 8;
  if (x < 8) x = Math.max(8, Math.min(innerWidth - pw - 8, r.left));
  if (y + ph > innerHeight - 8) y = innerHeight - ph - 8;
  pop.style.left = x + 'px'; pop.style.top = Math.max(8, y) + 'px';
}
function hideNotePop(delay) {
  clearTimeout(NotePop.hideT);
  const go = () => { const pop = $('#notePop'); if (pop) pop.hidden = true; NotePop.id = null; NotePop.edit = false; };
  if (delay) NotePop.hideT = setTimeout(go, delay); else go();
}
viewer.addEventListener('scroll', () => { if (!NotePop.edit) hideNotePop(); });

function noteEl(p, a, isSel) {
  const z = S.zoom, e = el('div', 'annot note' + (isSel ? ' sel' : ''));
  e.dataset.id = a.id; e.style.left = a.x * z + 'px'; e.style.top = a.y * z + 'px';
  e.style.width = e.style.height = 18 * z + 'px';
  const icon = el('div', 'content g'); icon.textContent = ''; icon.style.fontSize = 15 * z + 'px'; icon.style.color = a.color || '#f2b600'; e.append(icon);
  const editing = () => document.body.classList.contains('editing');
  // close the editor: an empty note is removed
  const closeEdit = () => {
    hideNotePop();
    if (!(a.text || '').trim()) { const i = p.annots.indexOf(a); if (i >= 0) p.annots.splice(i, 1); }
    if (S.annSel && S.annSel.a === a) S.annSel = null;
    renderAnnots(p);
  };
  if (isSel && editing()) {
    setTimeout(() => {
      if (!e.isConnected) return;
      showNotePop(e, a.text, { edit: true, id: a.id, onInput: v => { a.text = v; if (!dirty) { dirty = true; updateUI(); } }, onClose: closeEdit });
    });
  }
  e.addEventListener('pointerenter', () => { if (!(NotePop.edit && NotePop.id === a.id)) showNotePop(e, a.text, { id: a.id }); });
  e.addEventListener('pointerleave', () => { if (!NotePop.edit) hideNotePop(250); });
  if (editing()) {
    const del = el('button', 'del g'); del.textContent = ''; del.title = 'Delete note';
    del.addEventListener('pointerdown', ev => { ev.stopPropagation(); ev.preventDefault(); hideNotePop(); removeAnnot(p, a); });
    e.append(del);
  }
  e.addEventListener('pointerdown', ev => {
    if (!editing()) return;
    if (!isSel) { ev.stopPropagation(); ev.preventDefault(); hideNotePop(); selectAnnot(p, a); renderAnnots(p); return; }
    annotDown(ev, p, a, e);
  });
  return e;
}
// clicking anywhere else closes an open note editor
document.addEventListener('pointerdown', ev => {
  if (!NotePop.edit) return;
  const pop = $('#notePop'); if (pop && pop.contains(ev.target)) return;
  if (ev.target.closest && ev.target.closest('.annot.note.sel')) return;
  const sel = S.annSel; hideNotePop();
  if (sel && sel.a.type === 'note') {
    if (!(sel.a.text || '').trim()) { const i = sel.p.annots.indexOf(sel.a); if (i >= 0) sel.p.annots.splice(i, 1); }
    S.annSel = null; renderAnnots(sel.p);
  }
}, true);
function addNote(p, pt) {
  pushUndo();
  const a = { id: nid(), type: 'note', x: pt.x - 9, y: pt.y - 9, text: '', color: '#f2b600' };
  p.annots.push(a); S.annSel = { p, a }; setTool('select'); renderAnnots(p);
}
