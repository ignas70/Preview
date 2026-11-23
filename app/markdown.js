'use strict';
/* Preview – Markdown parser (no screen code; markdown-view.js draws the result).
   Turns Markdown text into plain objects. HTML inside the file is kept as ordinary text on purpose:
   it is never turned into page elements, so a .md file can't run scripts in the app.
   Blocks:  {t:'h', level, c} {t:'p', c} {t:'code', lang, v} {t:'quote', b} {t:'hr'}
            {t:'list', ordered, start, tight, items:[{task: null|true|false, b}]} {t:'table', align, head, rows}
   Inline:  {t:'text', v} {t:'code', v} {t:'strong'|'em'|'del', c} {t:'link', href, c} {t:'img', src, alt} {t:'br'}  */

const MD_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const MD_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const MD_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const MD_QUOTE = /^ {0,3}> ?/;
const MD_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/;
const MD_TABLE_SEP = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;
const MD_REF_DEF = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const mdRefKey = s => s.trim().replace(/\s+/g, ' ').toLowerCase();

function mdParse(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n').map(l => l.replace(/^\t+/, t => '    '.repeat(t.length)));
  const refs = new Map();
  let fence = null;
  for (const l of lines) {   // reference definitions can be used before they appear, so collect them first
    const f = l.match(MD_FENCE);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2]) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    const m = l.match(MD_REF_DEF); if (m && !refs.has(mdRefKey(m[1]))) refs.set(mdRefKey(m[1]), m[2]);
  }
  return mdBlocks(lines, refs);
}

// a line that ends a paragraph because it starts some other block
const mdStartsBlock = l => MD_FENCE.test(l) || MD_HEADING.test(l) || MD_HR.test(l) || MD_QUOTE.test(l) || (MD_ITEM.test(l) && MD_ITEM.exec(l)[4] !== undefined && MD_ITEM.exec(l)[4].trim() !== '');

function mdBlocks(lines, refs) {
  const out = [], inl = s => mdInline(s, refs);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(MD_FENCE))) {
      const mark = m[1], body = [];
      for (i++; i < lines.length; i++) {
        const f = lines[i].match(MD_FENCE);
        if (f && f[1][0] === mark[0] && f[1].length >= mark.length && !f[2]) { i++; break; }
        body.push(lines[i]);
      }
      out.push({ t: 'code', lang: m[2], v: body.join('\n') }); continue;
    }
    if ((m = line.match(MD_HEADING))) { out.push({ t: 'h', level: m[1].length, c: inl(m[2] || '') }); i++; continue; }
    if (MD_HR.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (MD_QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && (MD_QUOTE.test(lines[i]) || !mdStartsBlock(lines[i]))) body.push(lines[i++].replace(MD_QUOTE, ''));
      out.push({ t: 'quote', b: mdBlocks(body, refs) }); continue;
    }
    if (MD_ITEM.test(line)) { i = mdList(lines, i, refs, out); continue; }
    if (line.includes('|') && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = mdCells(line), align = mdCells(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:/.test(c) ? 'left' : '');
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) rows.push(mdCells(lines[i]));
      out.push({ t: 'table', align, head: head.map(inl), rows: rows.map(r => head.map((_, k) => inl(r[k] || ''))) }); continue;
    }
    if (/^ {4}/.test(line)) {
      const body = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].slice(4));
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push({ t: 'code', lang: '', v: body.join('\n') }); continue;
    }
    if (MD_REF_DEF.test(line)) { i++; continue; }
    const para = [line.trim()];
    for (i++; i < lines.length && lines[i].trim() && !mdStartsBlock(lines[i]); i++) {
      if (/^ {0,3}=+[ \t]*$/.test(lines[i]) || /^ {0,3}-+[ \t]*$/.test(lines[i])) break;
      if (lines[i].includes('|') && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1])) break;
      para.push(lines[i].replace(/^ +/, ''));
    }
    const setext = i < lines.length && (/^ {0,3}=+[ \t]*$/.test(lines[i]) ? 1 : /^ {0,3}-+[ \t]*$/.test(lines[i]) ? 2 : 0);
    if (setext) { out.push({ t: 'h', level: setext, c: inl(para.join('\n')) }); i++; }
    else out.push({ t: 'p', c: inl(para.join('\n')) });
  }
  return out;
}

// one list: items start at the same marker type; an item's own lines are indented under its text
function mdList(lines, i, refs, out) {
  const first = lines[i].match(MD_ITEM), ordered = /\d/.test(first[2]), markChar = first[2].slice(-1);
  const list = { t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, tight: true, items: [] };
  let sawBlank = false;
  while (i < lines.length) {
    const m = lines[i].match(MD_ITEM);
    if (!m || /\d/.test(m[2]) !== ordered || m[2].slice(-1) !== markChar) break;
    if (sawBlank) list.tight = false;
    const indent = m[1].length + m[2].length + Math.min(m[3] ? m[3].length : 1, 4);
    const body = [m[4] || ''];
    let blank = false;
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) { blank = true; body.push(''); continue; }
      const lead = l.match(/^ */)[0].length;
      if (lead >= indent) { body.push(l.slice(indent)); if (blank) list.tight = false; blank = false; continue; }
      if (!blank && !mdStartsBlock(l) && !MD_ITEM.test(l)) { body.push(l.trim()); continue; }   // lazy continuation of the text
      break;
    }
    while (body.length > 1 && !body[body.length - 1]) body.pop();
    sawBlank = blank;
    let task = null;
    const t = body[0].match(/^\[([ xX])\][ \t]+/);
    if (t) { task = t[1] !== ' '; body[0] = body[0].slice(t[0].length); }
    list.items.push({ task, b: mdBlocks(body, refs) });
  }
  out.push(list);
  return i;
}

function mdCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

/* ---- inline text ---- */
const MD_ESCAPABLE = /[!-/:-@[-`{-~]/;
function mdInline(s, refs) {
  const out = [];
  let buf = '', i = 0;
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  const push = n => { flush(); out.push(n); };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '\n') { push({ t: 'br' }); i += 2; continue; }
    if (c === '\\' && i + 1 < s.length && MD_ESCAPABLE.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (c === '\n') {
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); push({ t: 'br' }); } else { buf = buf.replace(/ +$/, '') + ' '; }
      i++; while (s[i] === ' ') i++; continue;
    }
    if (c === '`') {
      const run = s.slice(i).match(/^`+/)[0], end = s.indexOf(run, i + run.length);
      let close = end; while (close !== -1 && s[close + run.length] === '`') close = s.indexOf(run, close + run.length + 1);
      if (close !== -1) { let v = s.slice(i + run.length, close).replace(/\n/g, ' '); if (/^ .*[^ ].* $/.test(v)) v = v.slice(1, -1); push({ t: 'code', v }); i = close + run.length; continue; }
      buf += run; i += run.length; continue;
    }
    if (c === '<') {
      const a = s.slice(i).match(/^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i);
      if (a) { push({ t: 'link', href: a[1], c: [{ t: 'text', v: a[1] }] }); i += a[0].length; continue; }
    }
    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const img = c === '!', r = mdLink(s, img ? i + 1 : i, refs);
      if (r) {
        push(img ? { t: 'img', src: r.href, alt: mdPlain(r.text) } : { t: 'link', href: r.href, c: mdInline(r.text, refs) });
        i = r.end; continue;
      }
    }
    if (c === '*' || c === '_' || c === '~') {
      const r = mdEmphasis(s, i);
      if (r) { push({ t: r.t, c: mdInline(r.inner, refs) }); i = r.end; continue; }
      const run = s.slice(i).match(/^([*_~])\1*/)[0]; buf += run; i += run.length; continue;
    }
    buf += c; i++;
  }
  flush();
  return out;
}

const mdPlain = s => s.replace(/[*_`~]|!?\[|\]\([^)]*\)|\]/g, '');

// [text](url "title"), [text][ref], [text][] or [ref]; returns null when it isn't a link
function mdLink(s, i, refs) {
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '[') depth++;
    else if (s[j] === ']' && --depth === 0) break;
  }
  if (j >= s.length) return null;
  const text = s.slice(i + 1, j);
  if (s[j + 1] === '(') {
    let k = j + 2, d = 0;
    for (; k < s.length; k++) {
      if (s[k] === '\\') { k++; continue; }
      if (s[k] === '(') d++;
      else if (s[k] === ')') { if (d === 0) break; d--; }
    }
    if (k >= s.length) return null;
    const inside = s.slice(j + 2, k).trim(), m = inside.match(/^<([^>]*)>/) || inside.match(/^(\S*)/);
    return { text, href: m[1].replace(/\\(.)/g, '$1'), end: k + 1 };
  }
  const ref = s.slice(j + 1).match(/^\[([^\]]*)\]/);
  const key = mdRefKey(ref && ref[1] ? ref[1] : text);
  if (!refs.has(key)) return null;
  return { text, href: refs.get(key), end: ref ? j + 1 + ref[0].length : j + 1 };
}

// **strong**, __strong__, *em*, _em_, ~~del~~; underscores inside words (snake_case) are left alone
function mdEmphasis(s, i) {
  const ch = s[i], run = s.slice(i).match(/^([*_~])\1*/)[0].length, word = /[\p{L}\p{N}]/u;
  if (ch === '_' && i > 0 && word.test(s[i - 1])) return null;
  const len = ch === '~' ? (run >= 2 ? 2 : 0) : Math.min(run >= 3 ? 2 : run, 2);
  if (!len || /\s/.test(s[i + len] || ' ')) return null;
  const mark = ch.repeat(len);
  for (let j = s.indexOf(mark, i + len + 1); j !== -1; j = s.indexOf(mark, j + 1)) {
    let close = j;
    while (s[close + len] === ch) close++;   // "***x***": the closing mark is the last two or one of the run
    if (/\s/.test(s[close - 1])) continue;
    if (ch === '_' && word.test(s[close + len] || '')) continue;
    const inner = s.slice(i + len, close);
    if (!inner) continue;
    return { t: ch === '~' ? 'del' : len === 2 ? 'strong' : 'em', inner, end: close + len };
  }
  return null;
}
