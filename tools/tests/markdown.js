// Markdown (.md): parsing, display, and that HTML or scripts inside the file are never run.
test(async () => {
  // the parser on its own, without the screen
  await loadLib('markdown.js');
  const b = mdParse('# Title\n\nSome *soft* text\nwrapped.\n\n- a\n- b\n');
  check('parser: heading, paragraph, list', b.map(x => x.t).join(',') === 'h,p,list' && b[0].level === 1 && b[2].items.length === 2, b.map(x => x.t).join(','));
  check('parser: wrapped lines join into one paragraph', b[1].c.some(n => n.t === 'em'), JSON.stringify(b[1].c));
  const nested = mdParse('1. one\n   - inner\n2. two\n')[0];
  check('parser: numbered list with a nested list', nested.ordered && nested.items.length === 2 && nested.items[0].b.some(x => x.t === 'list'));
  check('parser: snake_case is not italic', !JSON.stringify(mdParse('my_file_name here')).includes('"em"'));

  const md = [
    '# Ataskaita', '', 'Setext heading', '--------------', '',
    'Text with **bold**, *italic*, ~~gone~~, `code` and a [link](https://example.com "Example").',
    'Reference [ref link][r] and <https://auto.example>.', '',
    '[r]: https://ref.example', '',
    '> Quote line', '> > nested quote', '',
    '- [x] done task', '- [ ] open task', '  - nested item', '',
    '| Name | Sum |', '|:-----|----:|', '| Ona | 1 250,00 € |', '| Jonas | 3 |', '',
    '```js', 'const x = "<b>not bold</b>";', '```', '',
    '***', '',
    'Raw <script>window.__mdHacked = 1</script> and <img src=x onerror="window.__mdHacked = 2"> stay text.', '',
    '[bad](javascript:window.__mdHacked=3) ![remote](https://example.com/track.png) ![inline](data:image/gif;base64,R0lGODlhAQABAAAAACw=)',
  ].join('\n');
  await openFiles([new File([md], 'notes.md')], null); await sleep(300);
  const box = document.querySelector('.mdDoc');
  check('.md opens in the Markdown view', !!box && $('#docKind').textContent.startsWith('Markdown'), $('#docKind').textContent);
  if (!box) return;
  const q = s => [...box.querySelectorAll(s)];
  check('headings', q('h1')[0]?.textContent === 'Ataskaita' && q('h2')[0]?.textContent === 'Setext heading', q('h1,h2').map(e => e.textContent).join(' | '));
  check('bold, italic, strikethrough, code', q('strong')[0]?.textContent === 'bold' && q('em')[0]?.textContent === 'italic' && q('del')[0]?.textContent === 'gone' && q('p code')[0]?.textContent === 'code');
  const links = q('a').map(a => a.textContent + '=' + a.title);
  check('links, reference links and autolinks', links.includes('link=https://example.com') && links.includes('ref link=https://ref.example') && links.includes('https://auto.example=https://auto.example'), links.join(' | '));
  check('nested quote', q('blockquote blockquote').length === 1);
  const boxes = q('li input[type=checkbox]');
  check('task list with ticks', boxes.length === 2 && boxes[0].checked && !boxes[1].checked && boxes.every(c => c.disabled));
  check('nested list item', q('li ul li')[0]?.textContent === 'nested item');
  const cells = q('td').map(td => td.textContent + ':' + td.style.textAlign);
  check('table cells and alignment', cells.join(' | ') === 'Ona:left | 1 250,00 €:right | Jonas:left | 3:right', cells.join(' | '));
  check('code block kept as text', q('pre code')[0]?.textContent === 'const x = "<b>not bold</b>";' && !q('pre b').length);
  check('horizontal rule', q('hr').length === 1);
  check('raw HTML is shown as text, never run', !window.__mdHacked && !box.querySelector('script, img[src="x"]') && box.textContent.includes('<script>'), String(window.__mdHacked));
  const bad = q('a').find(a => a.textContent === 'bad');
  if (bad) bad.click(); await sleep(100);
  check('javascript: link does nothing', !window.__mdHacked && (!bad || !/^javascript:/i.test(bad.getAttribute('href') || '')));
  check('remote image is not loaded', !q('img').some(i => /^https?:/.test(i.src)) && box.textContent.includes('remote'));
  check('embedded image is shown', q('img').some(i => i.src.startsWith('data:image/')));

  await openFiles([new File(['plain\ntext'], 'a.txt')], null); await sleep(200);
  check('.txt still opens as plain text', !!document.querySelector('pre.txt') && !document.querySelector('.mdDoc'));
});
