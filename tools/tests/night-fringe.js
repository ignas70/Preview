// Measures coloured fringes around text in night mode (text should be pure grey after inversion).
setTimeout(async () => {
  try {
    setNight(true);
    await new Promise(r => setTimeout(r, 2500));
    const c = S.pages[0].el.querySelector('canvas'), x = c.getContext('2d');
    // a block of body text (abstract area, left column)
    const w = Math.round(c.width * 0.3), h = Math.round(c.height * 0.12);
    const d = x.getImageData(Math.round(c.width * 0.12), Math.round(c.height * 0.72), w, h).data;
    let colored = 0, total = 0, maxChroma = 0;
    for (let i = 0; i < d.length; i += 4) {
      const ch = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (lum > 40) { total++; if (ch > 24) colored++; maxChroma = Math.max(maxChroma, ch); }
    }
    mark('night text pixels=' + total + ' coloured=' + colored + ' (' + (100 * colored / Math.max(1, total)).toFixed(1) + '%) maxChroma=' + maxChroma);
  } catch (e) { mark('ERR ' + e.message); }
}, 1200);
