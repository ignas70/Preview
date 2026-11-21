// E-signature containers: signers + documents; then open the inner document.
setTimeout(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await sleep(800);
    for (const c of document.querySelectorAll('.sigCard')) mark('card: ' + c.className + ' | ' + c.innerText.replace(/\n/g, ' / '));
    mark('head: ' + (document.querySelector('.esHead') || {}).innerText);
    mark('docs: ' + [...document.querySelectorAll('.esDoc')].map(d => d.innerText.replace(/\n/g, ' ')).join(' ; '));
  } catch (e) { mark('ERR ' + e.stack); }
}, 300);
