// PDF signatures banner + details; container → open inner document → banner → back.
setTimeout(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await sleep(2500);
    const b = document.querySelector('#pdfSigBanner');
    mark('pdf banner hidden=' + b.hidden + ' text=' + b.innerText.replace(/\n/g, ' | '));
    for (const s of S.pdfSigs || []) mark('sig: docsOk=' + s.docsOk + ' sigOk=' + s.sigOk + ' coversAll=' + s.coversAll + ' name=' + signerName(s) + ' problems=' + s.problems.join(';'));
    if (!b.hidden) { b.querySelector('button').click(); await sleep(200); mark('dialog open=' + document.querySelector('#sigDlg').open); }
  } catch (e) { mark('ERR ' + e.stack); }
}, 300);
