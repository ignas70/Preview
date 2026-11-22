// open: tracemonkey.pdf
// Night mode: text must stay grey after inversion, without coloured (magenta/green) fringes.
test(async () => {
  setNight(true);
  await sleep(2500);
  const c = S.pages[0].el.querySelector('canvas'), x = c.getContext('2d');
  const w = Math.round(c.width * 0.3), h = Math.round(c.height * 0.12);
  const d = x.getImageData(Math.round(c.width * 0.12), Math.round(c.height * 0.72), w, h).data;
  let coloured = 0, total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const chroma = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 40) { total++; if (chroma > 24) coloured++; }
  }
  check('body text is found on the page', total > 1000, total);
  check('under 2% of text pixels are coloured', coloured / Math.max(1, total) < 0.02, (100 * coloured / Math.max(1, total)).toFixed(1) + '%');
  setNight(false);
});
