'use strict';
/* Preview – settings, menus, shared toolbar pieces, recent files and start-up. */

/* ================= settings (kept by the Windows host) ================= */
async function loadSettings() {
  if (!host) return;
  const r = await hostCall('getSettings');
  $('#setTabs').checked = !!r.tabs; $('#setStartup').checked = !!r.startup; $('#setUpdates').checked = r.updates !== false;
  showUpdateState(r);
}
// ---- updates (the host checks the GitHub releases and runs the new setup) ----
let updVersion = null;
function showUpdateState(r) {
  updVersion = r.latest || null;
  $('#updInfo').textContent = `Version ${r.version || '?'}` + (r.latest ? ` · version ${r.latest} is available` : r.checked ? ' · up to date' : '') + (r.error ? ` · could not check (${r.error})` : '');
  $('#updBtn').textContent = r.latest ? 'Update now' : 'Check now';
  $('#updBtn').classList.toggle('primary', !!r.latest);
}
async function installUpdate() {
  busy('Downloading the update…');
  const r = await hostCall('installUpdate');
  busy(false);
  if (r.error) toast('Could not update: ' + r.error, 5000); else busy('Installing the update…');
}
$('#updBtn').addEventListener('click', async () => {
  if (updVersion) { installUpdate(); return; }
  $('#updBtn').disabled = true; $('#updInfo').textContent = 'Checking…';
  const r = await hostCall('checkUpdate'); $('#updBtn').disabled = false;
  showUpdateState({ ...r, checked: !r.error });
});
if (host) host.addEventListener('message', e => {
  const m = e.data; if (!m || m.cmd !== 'updateAvailable') return;
  updVersion = m.version; loadSettings();
  toastAction(`Preview ${m.version} is available`, 'Update', installUpdate, 12000);
});
for (const [id, name] of [['#setTabs', 'tabs'], ['#setStartup', 'startup'], ['#setUpdates', 'updates']]) {
  $(id).addEventListener('change', async e => {
    const r = await hostCall('setSetting', { name, value: e.target.checked });
    if (r.error) { toast('Could not change the setting: ' + r.error, 4000); e.target.checked = !e.target.checked; return; }
    if (name === 'startup') toast(e.target.checked ? 'Preview will start with Windows' : 'Preview will no longer start with Windows', 2500);
  });
}
loadSettings();

/* ================= small UI helpers: popup menu, toast with action ================= */
function showMenu(anchor, items, opts = {}) {
  closeMenu();
  const m = el('div', 'menu'); m.id = 'popMenu';
  for (const it of items) {
    if (it === '-') { m.append(el('div', 'msep')); continue; }
    const b = el('button', 'mi'); if (it.disabled) b.disabled = true;
    const g = el('span', 'g'); g.textContent = it.icon || ''; b.append(g);
    const t = el('span', 'ml'); t.textContent = it.label;
    if (it.hint) { const h = el('small'); h.textContent = it.hint; t.append(h); b.title = it.hint; }
    b.append(t);
    if (it.key) { const k = el('span', 'mk'); k.textContent = it.key; b.append(k); }
    b.addEventListener('click', () => { closeMenu(); it.run(); });
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const left = opts.align === 'left' ? Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8))
    : Math.min(window.innerWidth - m.offsetWidth - 8, Math.max(8, r.right - m.offsetWidth));
  m.style.left = left + 'px'; m.style.top = r.bottom + 4 + 'px';
  setTimeout(() => document.addEventListener('pointerdown', menuAway, true));
}
function menuAway(e) { const m = $('#popMenu'); if (m && !m.contains(e.target)) closeMenu(); }
function closeMenu() { $('#popMenu')?.remove(); document.removeEventListener('pointerdown', menuAway, true); }
function toastAction(msg, label, fn, ms = 6000) {
  const t = $('#toast'); t.textContent = msg;
  const b = el('button', 'tact'); b.textContent = label; b.addEventListener('click', () => { t.classList.remove('show'); fn(); });
  t.append(b); t.classList.add('show', 'withAction');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show', 'withAction'), ms);
}

/* ================= shared toolbar pieces ================= */
// Open ▾ – recent files
document.querySelectorAll('.recentBtn').forEach(b => b.addEventListener('click', () => {
  const items = [{ icon: '', label: 'Open a file…', key: 'Ctrl+O', run: openDialog }];
  if (host) items.push({ icon: '', label: 'New tab', key: 'Ctrl+T', run: () => hostCall('newWindow', { path: null }) });
  const rec = host ? getRecent().filter(p => p !== Cur.path).slice(0, 8) : [];
  if (rec.length) { items.push('-'); for (const p of rec) items.push({ icon: '', label: p.split(/[\\/]/).pop(), hint: dirOf(p), run: () => openPath(p) }); }
  showMenu(b.closest('.split'), items, { align: 'left' });
}));
// page panel
function toggleSidebar(force) {
  const hide = force != null ? !force : !document.body.classList.contains('noSide');
  document.body.classList.toggle('noSide', hide);
  $('#btnSidebar').classList.toggle('on', !hide);
  try { localStorage.setItem('preview.side', hide ? '0' : '1'); } catch { }
}
$('#btnSidebar').addEventListener('click', () => toggleSidebar());
try { toggleSidebar(localStorage.getItem('preview.side') !== '0'); } catch { toggleSidebar(true); }
// keyboard shortcuts (F1)
function openKeys() { const d = $('#keysDlg'); if (!d.open) d.showModal(); }
$('#keysClose').addEventListener('click', () => $('#keysDlg').close());
$('#keysDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
document.querySelectorAll('.keysBtn').forEach(b => b.addEventListener('click', openKeys));
$('#toSettings').addEventListener('click', () => $('#settingsWrap').scrollIntoView({ behavior: 'smooth', block: 'start' }));
// the same "more" items for every kind of file
const themeItem = () => ({ icon: '', label: 'Theme: ' + themeNames[Theme.mode], hint: 'click to change', run: () => setThemeMode({ auto: 'light', light: 'dark', dark: 'auto' }[Theme.mode]) });
const fileItems = () => [
  { icon: '', label: 'Open with another app…', disabled: !host || !Cur.path, run: () => hostCall('openWith', { path: Cur.path }) },
  { icon: '', label: 'Show in folder', disabled: !host || !Cur.path, run: () => hostCall('showInFolder', { path: Cur.path }) },
];
const appItems = () => [themeItem(), { icon: '', label: 'Keyboard shortcuts', key: 'F1', run: openKeys }];
$('#btnDocMore').addEventListener('click', e => {
  const slides = !$('#docPresent').hidden;
  showMenu(e.currentTarget, [
    ...(slides ? [{ icon: '', label: 'Present', key: 'F5', run: present }] : []),
    { icon: '', label: 'Print…', key: 'Ctrl+P', run: () => window.print() },
    { icon: '', label: 'Save as PDF…', run: saveDocAsPdf },
    '-', ...fileItems(), '-', ...appItems(),
  ]);
});

$('#btnPdfMore').addEventListener('click', e => showMenu(e.currentTarget, [
  { icon: '', label: 'Find…', key: 'Ctrl+F', run: openFind },
  { icon: '', label: 'Recognize text (OCR)', run: () => runOcr() },
  { icon: '', label: 'Print…', key: 'Ctrl+P', run: printPdf },
  { icon: '', label: 'Present', key: 'F5', run: present },
  '-',
  { icon: '', label: 'Save a copy…', key: 'Ctrl+S', run: () => save() },
  { icon: '', label: 'Save a compressed copy…', run: () => save(S.pages, '-compressed', { compress: true }) },
  { icon: '', label: 'Save a flattened copy…', run: () => save(S.pages, '-flattened', { flatten: true }) },
  '-',
  { icon: '', label: 'Insert blank page', run: () => { setEditing(true); insertBlankPage(); } },
  { icon: '', label: 'Add PDFs or images…', run: () => { setEditing(true); $('#fileAdd').click(); } },
  '-',
  ...fileItems(), '-',
  { icon: '', label: document.body.classList.contains('noSide') ? 'Show page panel' : 'Hide page panel', key: 'Ctrl+B', run: () => toggleSidebar() },
  ...appItems(),
]));


/* ---- recent files ---- */
function getRecent() { try { return JSON.parse(localStorage.getItem('preview.recent') || '[]'); } catch { return []; } }
function addRecent(p) {
  const l = getRecent().filter(x => x.toLowerCase() !== p.toLowerCase()); l.unshift(p);
  try { localStorage.setItem('preview.recent', JSON.stringify(l.slice(0, 12))); } catch { }
}
const KIND_NAMES = { pdf: 'PDF document', docx: 'Word document', sheet: 'Spreadsheet', numbers: 'Numbers spreadsheet', pptx: 'PowerPoint presentation', apple: 'Apple document', google: 'Google link', text: 'Text file', markdown: 'Markdown document', old: 'Legacy document', esign: 'Signed container' };
function badgeFor(ext) {
  const k = EXT[ext], b = el('span', 'badge');
  const legacy = /^(doc|dot|rtf|odt)$/.test(ext) ? ['word', 'W'] : /^(ppt|pps|odp)$/.test(ext) ? ['ppt', 'P'] : null;
  const m = legacy || { pdf: ['pdf', 'PDF'], docx: ['word', 'W'], sheet: ['excel', 'X'], numbers: ['apple', 'N'], pptx: ['ppt', 'P'], apple: ['apple', ext === 'key' ? 'K' : 'P'], google: ['google', 'G'], image: ['other', 'IMG'], esign: ['esign', 'SIG'] }[k] || ['other', (ext || '?').slice(0, 3).toUpperCase()];
  b.classList.add(m[0]); b.textContent = m[1]; return b;
}
function renderRecent() {
  const l = host ? getRecent().slice(0, 8) : [], box = $('#recent');
  $('#recentWrap').hidden = !l.length; box.textContent = '';
  l.forEach(p => {
    const b = el('button'), n = el('span', 'rn'), d = el('span', 'rp');
    n.textContent = p.split(/[\\/]/).pop(); d.textContent = dirOf(p); b.title = p;
    b.append(badgeFor(extOf(p)), n, d); b.addEventListener('click', () => openPath(p)); box.append(b);
  });
}

updateUI(); updateThumbSel();
// Start loading the viewer for this file type while the file itself is being read.
function prefetchFor(ext) {
  const jobs = {
    pdf: () => ensurePdfJs(),
    docx: () => loadLib('lib/jszip.min.js').then(() => loadLib('lib/docx-preview.min.js')),
    sheet: () => loadLib('lib/xlsx.full.min.js'), numbers: () => loadLib('lib/xlsx.full.min.js'),
    pptx: () => loadLib('lib/pptx-preview.umd.js'),
    apple: () => loadLib('lib/jszip.min.js').then(() => loadLib('lib/iwork.js')),
  };
  const job = jobs[EXT[ext]]; if (job) job().catch(() => { });
}
const startPath = new URLSearchParams(location.search).get('path');
if (startPath && host) { prefetchFor(extOf(startPath)); openPath(startPath); } else setMode('home');
