// Put in front of every test by tools/run-tests.ps1 and run inside Preview (PREVIEW_EVAL).
// Results go to the trace file as "PASS name" / "FAIL name — detail" lines, then "DONE".
// TESTFILES (the testfiles folder, with a trailing backslash) is defined by the runner.
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, detail) {
  mark((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && detail !== '' ? ' — ' + detail : ''));
  return !!ok;
}
function test(fn, delay = 1200) {
  setTimeout(async () => {
    try { await fn(); }
    catch (e) { check('finished without an error', false, e.message + ' ' + String(e.stack).split('\n')[1]); }
    mark('DONE');
  }, delay);
}
