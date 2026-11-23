'use strict';
/* Preview – draws Markdown parsed by markdown.js. Every piece of text goes in with textContent, so nothing in
   the file becomes HTML. Links open in the browser (web, mail) or in Preview (other local files);
   web pictures are not downloaded (a .md file could use them to track who opened it), local and embedded ones are shown. */

const MD_WEB = /^(https?:|mailto:)/i;
// a link or picture path inside the file → full local path, or null when it isn't a local file
function mdLocalPath(href, baseDir) {
  if (!href || href.startsWith('#')) return null;
  let p; try { p = decodeURIComponent(href.split('#')[0]); } catch { p = href.split('#')[0]; }
  if (/^file:/i.test(p)) p = p.replace(/^file:\/*/i, '');
  if (/^[a-z]:[\\/]/i.test(p) || p.startsWith('\\\\')) return p.replace(/\//g, '\\');
  if (!p || /^[a-z][a-z0-9+.-]+:/i.test(p)) return null;   // web, mail, javascript: and other schemes
  if (!baseDir) return null;
  const parts = baseDir.replace(/\//g, '\\').split('\\');
  for (const s of p.split(/[\\/]/)) { if (s === '..') parts.length > 1 && parts.pop(); else if (s && s !== '.') parts.push(s); }
  return parts.join('\\');
}
const mdSlug = s => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

function renderMarkdown(text, inner, baseDir) {
  const box = el('article', 'mdDoc');
  const used = new Map();
  const inline = (nodes, parent) => {
    for (const n of nodes) {
      if (n.t === 'text') parent.append(n.v);
      else if (n.t === 'br') parent.append(el('br'));
      else if (n.t === 'code') { const c = el('code'); c.textContent = n.v; parent.append(c); }
      else if (n.t === 'strong' || n.t === 'em' || n.t === 'del') { const e = el(n.t); inline(n.c, e); parent.append(e); }
      else if (n.t === 'link') parent.append(mdLinkEl(n, baseDir, e => inline(n.c, e)));
      else if (n.t === 'img') parent.append(mdImage(n, baseDir));
    }
  };
  const blocks = (list, parent, tight) => {
    for (const b of list) {
      if (b.t === 'p') { if (tight) inline(b.c, parent); else { const p = el('p'); inline(b.c, p); parent.append(p); } }
      else if (b.t === 'h') {
        const h = el('h' + b.level); inline(b.c, h);
        const base = mdSlug(h.textContent) || 'section', n = used.get(base) || 0;
        used.set(base, n + 1); h.id = 'md-' + base + (n ? '-' + n : '');
        parent.append(h);
      } else if (b.t === 'code') {
        const pre = el('pre'), c = el('code'); c.textContent = b.v; if (b.lang) pre.dataset.lang = b.lang;
        pre.append(c); parent.append(pre);
      } else if (b.t === 'quote') { const q = el('blockquote'); blocks(b.b, q); parent.append(q); }
      else if (b.t === 'hr') parent.append(el('hr'));
      else if (b.t === 'list') {
        const l = el(b.ordered ? 'ol' : 'ul');
        if (b.ordered && b.start !== 1) l.start = b.start;
        for (const it of b.items) {
          const li = el('li');
          if (it.task !== null) {
            li.className = 'task';
            const cb = el('input'); cb.type = 'checkbox'; cb.checked = it.task; cb.disabled = true; li.append(cb);
          }
          blocks(it.b, li, b.tight); l.append(li);
        }
        parent.append(l);
      } else if (b.t === 'table') {
        const wrap = el('div', 'mdTable'), t = el('table'), head = el('tr');
        b.head.forEach((c, k) => { const th = el('th'); th.style.textAlign = b.align[k] || ''; inline(c, th); head.append(th); });
        const thead = el('thead'); thead.append(head); t.append(thead);
        const body = el('tbody');
        for (const r of b.rows) { const tr = el('tr'); r.forEach((c, k) => { const td = el('td'); td.style.textAlign = b.align[k] || ''; inline(c, td); tr.append(td); }); body.append(tr); }
        t.append(body); wrap.append(t); parent.append(wrap);
      }
    }
  };
  blocks(mdParse(text), box);
  inner.append(box);
}

function mdLinkEl(n, baseDir, fill) {
  const a = el('a'); fill(a);
  a.title = n.href;
  a.href = '#';   // the real target is handled on click, so a "javascript:" link in the file can never run
  a.addEventListener('click', e => {
    e.preventDefault();
    const h = n.href;
    if (MD_WEB.test(h)) { openUrl(h); return; }
    if (h.startsWith('#')) {
      const target = document.getElementById('md-' + mdSlug(decodeURIComponent(h.slice(1))));
      if (target) target.scrollIntoView({ block: 'start' });
      return;
    }
    const p = mdLocalPath(h, baseDir);
    if (p && host) openPath(p);
  });
  return a;
}

function mdImage(n, baseDir) {
  const local = /^data:image\//i.test(n.src) ? n.src : host && mdLocalPath(n.src, baseDir) ? fileUrl(mdLocalPath(n.src, baseDir)) : null;
  if (!local) {   // a web picture: show its description as a link instead of downloading it
    const a = mdLinkEl({ href: n.src }, baseDir, e => { const g = el('span', 'g'); g.textContent = '\uE91B'; e.className = 'mdImgLink'; e.append(g, ' ' + (n.alt || 'picture')); });
    if (MD_WEB.test(n.src)) a.title = 'Picture from the web (not downloaded): ' + n.src;
    return a;
  }
  const img = el('img'); img.alt = n.alt; img.src = local; img.loading = 'lazy';
  return img;
}
