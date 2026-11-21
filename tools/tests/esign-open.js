setTimeout(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await sleep(800);
    document.querySelectorAll('.esDoc')[1].click(); await sleep(2500);
    mark('mode=' + document.body.dataset.mode + ' banner=' + document.querySelector('#pdfSigBanner').innerText.replace(/\n/g, ' | ') + ' hidden=' + document.querySelector('#pdfSigBanner').hidden);
  } catch (e) { mark('ERR ' + e.stack); }
}, 300);
