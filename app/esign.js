'use strict';
/* Preview – electronic signatures.
   • ASiC-E / BDOC / ADOC / EDOC containers (Smart-ID, Mobile-ID, ID card, GoSign, Dokobit …):
     lists the signed documents and every signature, and verifies them.
   • Digital signatures inside PDFs (PAdES): same check, shown as a banner above the document.
   What is verified: that the documents were not changed after signing (hashes) and that the signature
   value matches the signer's certificate. Not verified (needs online trust lists): whether the certificate
   was trusted and not revoked at that time – the issuer is shown instead. */

/* ---------- tiny DER / ASN.1 reader ---------- */
function asn(buf, off = 0) {
  const tag = buf[off]; let len = buf[off + 1], hl = 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i]; hl = 2 + n; }
  const end = off + hl + len;
  return { tag, off, end, raw: buf.subarray(off, end), body: buf.subarray(off + hl, end) };
}
function kids(node) { const out = []; let p = 0; const b = node.body; while (p < b.length) { const c = asn(b, p); out.push(c); p = c.end; } return out; }
function oidStr(b) {
  const parts = [Math.floor(b[0] / 40), b[0] % 40]; let v = 0;
  for (let i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { parts.push(v); v = 0; } }
  return parts.join('.');
}
function asnString(n) {
  if (n.tag === 0x0c) return new TextDecoder('utf-8').decode(n.body);
  if (n.tag === 0x1e) { let s = ''; for (let i = 0; i + 1 < n.body.length; i += 2) s += String.fromCharCode((n.body[i] << 8) | n.body[i + 1]); return s; }
  return new TextDecoder('latin1').decode(n.body);
}
function asnTime(n) {
  const s = new TextDecoder().decode(n.body);
  const m = n.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?/.exec(s) : /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?/.exec(s);
  if (!m) return null;
  let y = +m[1]; if (n.tag === 0x17) y += y < 50 ? 2000 : 1900;
  return new Date(Date.UTC(y, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
}
const NAME_OIDS = { '2.5.4.3': 'CN', '2.5.4.4': 'SN', '2.5.4.42': 'GN', '2.5.4.5': 'serialNumber', '2.5.4.6': 'C', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.97': 'orgId', '1.2.840.113549.1.9.1': 'email' };
function asnName(n) {
  const o = {};
  for (const set of kids(n)) for (const atv of kids(set)) { const [t, v] = kids(atv); const k = NAME_OIDS[oidStr(t.body)]; if (k && v) o[k] = asnString(v); }
  return o;
}
function parseCert(der) {
  const cert = asn(der), [tbs] = kids(cert);
  const f = kids(tbs); let i = 0;
  if (f[0].tag === 0xa0) i++;
  const serial = f[i].body, issuer = asnName(f[i + 2]), validity = kids(f[i + 3]), subject = asnName(f[i + 4]), spki = f[i + 5];
  const [alg] = kids(spki), [algOid, algParam] = kids(alg);
  const keyAlg = oidStr(algOid.body), curve = algParam && algParam.tag === 0x06 ? oidStr(algParam.body) : null;
  return { der, serial, issuer, subject, notBefore: asnTime(validity[0]), notAfter: asnTime(validity[1]), spki: spki.raw, keyAlg, curve };
}
const b64ToBytes = s => Uint8Array.from(atob(s.replace(/\s+/g, '')), c => c.charCodeAt(0));
const bytesToB64 = b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const CURVES = { '1.2.840.10045.3.1.7': ['P-256', 32], '1.3.132.0.34': ['P-384', 48], '1.3.132.0.35': ['P-521', 66] };
async function verifySig(cert, hash, kind, sigBytes, data) {
  if (cert.keyAlg === '1.2.840.10045.2.1') {
    const c = CURVES[cert.curve]; if (!c) throw new Error('unsupported curve');
    let raw = sigBytes;
    if (sigBytes[0] === 0x30 && sigBytes.length !== c[1] * 2) {   // DER (r,s) → raw r||s
      const [r, s] = kids(asn(sigBytes)), fix = x => { let b = x.body; while (b.length > c[1] && b[0] === 0) b = b.subarray(1); const o = new Uint8Array(c[1]); o.set(b, c[1] - b.length); return o; };
      raw = new Uint8Array(c[1] * 2); raw.set(fix(r)); raw.set(fix(s), c[1]);
    }
    const key = await crypto.subtle.importKey('spki', cert.spki, { name: 'ECDSA', namedCurve: c[0] }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash }, key, raw, data);
  }
  if (kind === 'pss') {
    const key = await crypto.subtle.importKey('spki', cert.spki, { name: 'RSA-PSS', hash }, false, ['verify']);
    return crypto.subtle.verify({ name: 'RSA-PSS', saltLength: { 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64, 'SHA-1': 20 }[hash] }, key, sigBytes, data);
  }
  const key = await crypto.subtle.importKey('spki', cert.spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, data);
}
const digest = async (hash, data) => new Uint8Array(await crypto.subtle.digest(hash, data));

/* ---------- XML canonicalization (C14N 1.0 / 1.1 and exclusive C14N) ---------- */
function c14n(root, exclusive) {
  const out = [];
  const escT = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
  const escA = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
  const scopeOf = e => { const m = new Map(), chain = []; for (let n = e; n && n.nodeType === 1; n = n.parentNode) chain.unshift(n); for (const n of chain) for (const a of n.attributes) { if (a.name === 'xmlns') m.set('', a.value); else if (a.name.startsWith('xmlns:')) m.set(a.name.slice(6), a.value); } return m; };
  const walk = (e, rendered) => {
    const scope = scopeOf(e), decl = [];
    const want = exclusive ? (() => { const u = new Set([e.prefix || '']); for (const a of e.attributes) if (a.prefix && a.prefix !== 'xmlns') u.add(a.prefix); return [...u].map(p => [p, scope.get(p) || '']); })() : [...scope];
    for (const [p, uri] of want) { if (p === '' && uri === '' && !rendered.get('')) continue; if (rendered.get(p) !== uri) decl.push([p, uri]); }
    decl.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const r2 = new Map(rendered); for (const [p, u] of decl) r2.set(p, u);
    const attrs = [...e.attributes].filter(a => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))
      .sort((x, y) => { const ux = x.namespaceURI || '', uy = y.namespaceURI || ''; if (ux !== uy) return ux < uy ? -1 : 1; return x.localName < y.localName ? -1 : x.localName > y.localName ? 1 : 0; });
    out.push('<' + e.nodeName);
    for (const [p, u] of decl) out.push(' ' + (p ? 'xmlns:' + p : 'xmlns') + '="' + escA(u) + '"');
    for (const a of attrs) out.push(' ' + a.name + '="' + escA(a.value) + '"');
    out.push('>');
    for (const c of e.childNodes) { if (c.nodeType === 1) walk(c, r2); else if (c.nodeType === 3 || c.nodeType === 4) out.push(escT(c.nodeValue)); }
    out.push('</' + e.nodeName + '>');
  };
  walk(root, new Map());
  return new TextEncoder().encode(out.join(''));
}

/* ---------- ASiC-E / BDOC / ADOC containers ---------- */
const DIGESTS = { 'http://www.w3.org/2001/04/xmlenc#sha256': 'SHA-256', 'http://www.w3.org/2000/09/xmldsig#sha1': 'SHA-1', 'http://www.w3.org/2001/04/xmldsig-more#sha384': 'SHA-384', 'http://www.w3.org/2001/04/xmlenc#sha512': 'SHA-512', 'http://www.w3.org/2001/04/xmldsig-more#sha224': null };
function sigMethod(uri) {
  const m = /(rsa|ecdsa)-(sha1|sha224|sha256|sha384|sha512)$/.exec(uri || '');
  if (m) return { kind: m[1], hash: 'SHA-' + m[2].slice(3) };
  const p = /(sha256|sha384|sha512)-rsa-MGF1$/.exec(uri || '');
  if (p) return { kind: 'pss', hash: 'SHA-' + p[1].slice(3) };
  return null;
}
async function readContainer(bytes) {
  await loadLib('lib/jszip.min.js');
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  const docs = names.filter(n => !/^META-INF\//i.test(n) && n !== 'mimetype');
  const sigFiles = names.filter(n => /^META-INF\/.*signature.*\.xml$/i.test(n));
  const files = new Map(); for (const n of docs) files.set(n, await zip.file(n).async('uint8array'));
  const sigs = [];
  for (const sf of sigFiles) {
    const dom = new DOMParser().parseFromString(await zip.file(sf).async('string'), 'application/xml');
    for (const s of dom.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')) sigs.push(await checkXadesSignature(s, files));
  }
  return { docs: docs.map(n => ({ name: n, bytes: files.get(n) })), sigs };
}
async function checkXadesSignature(sigEl, files) {
  const DS = 'http://www.w3.org/2000/09/xmldsig#';
  const q = (e, ns, n) => e ? e.getElementsByTagNameNS(ns, n)[0] : null;
  const qx = (e, n) => e ? e.getElementsByTagNameNS('*', n)[0] : null;
  const r = { signer: null, time: null, problems: [], docsOk: null, sigOk: null, level: [] };
  try {
    const certB64 = (q(sigEl, DS, 'X509Certificate') || {}).textContent;
    if (certB64) r.cert = parseCert(b64ToBytes(certB64));
    const st = qx(sigEl, 'SigningTime'); if (st) r.time = new Date(st.textContent.trim());
    const city = qx(sigEl, 'City'), country = qx(sigEl, 'CountryName'), role = qx(sigEl, 'ClaimedRole');
    r.place = [city && city.textContent, country && country.textContent].filter(Boolean).join(', ');
    r.role = role ? role.textContent : '';
    if (qx(sigEl, 'SignatureTimeStamp')) r.level.push('time-stamped');
    if (qx(sigEl, 'OCSPValues') || qx(sigEl, 'EncapsulatedOCSPValue')) r.level.push('validity confirmation (OCSP)');
    const si = q(sigEl, DS, 'SignedInfo');
    // 1) every referenced document / property block must still match its digest
    let ok = true;
    for (const ref of si.getElementsByTagNameNS(DS, 'Reference')) {
      const uri = ref.getAttribute('URI') || '', hash = DIGESTS[(q(ref, DS, 'DigestMethod') || {}).getAttribute?.('Algorithm')];
      const want = b64ToBytes((q(ref, DS, 'DigestValue') || {}).textContent || '');
      if (!hash) { r.problems.push('Unsupported digest algorithm'); ok = false; continue; }
      let data;
      if (uri.startsWith('#')) {
        const id = uri.slice(1), target = [...sigEl.ownerDocument.getElementsByTagName('*')].find(x => x.getAttribute('Id') === id);
        if (!target) { r.problems.push('Signed properties missing'); ok = false; continue; }
        const tr = [...ref.getElementsByTagNameNS(DS, 'Transform')].map(t => t.getAttribute('Algorithm') || '').join(' ');
        data = c14n(target, /exc-c14n/.test(tr));
      } else {
        let name = uri; try { name = decodeURIComponent(uri); } catch { }
        data = files.get(name) || files.get(uri);
        if (!data) { r.problems.push(`Signed file "${name}" is missing from the container`); ok = false; continue; }
      }
      if (!sameBytes(await digest(hash, data), want)) { ok = false; r.problems.push(uri.startsWith('#') ? 'Signature details were altered' : `"${decodeURIComponent(uri)}" was changed after signing`); }
    }
    r.docsOk = ok;
    // 2) the signature value over SignedInfo must match the signer's key
    const meth = sigMethod((q(si, DS, 'SignatureMethod') || {}).getAttribute?.('Algorithm'));
    const canon = (q(si, DS, 'CanonicalizationMethod') || {}).getAttribute?.('Algorithm') || '';
    if (r.cert && meth) {
      try { r.sigOk = await verifySig(r.cert, meth.hash, meth.kind, b64ToBytes(q(sigEl, DS, 'SignatureValue').textContent), c14n(si, /exc-c14n/.test(canon))); }
      catch (e) { r.problems.push('Signature could not be checked (' + e.message + ')'); }
    } else r.problems.push('Unsupported signature method');
  } catch (e) { r.problems.push('Could not read signature: ' + e.message); }
  if (r.cert && r.time && (r.time < r.cert.notBefore || r.time > r.cert.notAfter)) r.problems.push('Certificate was not valid at the signing time');
  return r;
}

/* ---------- PDF (PAdES / PKCS#7) signatures ---------- */
const HASH_OIDS = { '2.16.840.1.101.3.4.2.1': 'SHA-256', '2.16.840.1.101.3.4.2.2': 'SHA-384', '2.16.840.1.101.3.4.2.3': 'SHA-512', '1.3.14.3.2.26': 'SHA-1' };
async function checkPkcs7(p7, signedData) {
  const r = { problems: [], level: [] };
  const ci = asn(p7), [, wrap] = kids(ci);
  if (!wrap) throw new Error('the signature is empty – signing was not completed');
  const sd = kids(kids(wrap)[0]);
  const certsNode = sd.find(n => n.tag === 0xa0), infos = sd[sd.length - 1];
  const certs = certsNode ? kids(certsNode).filter(c => c.tag === 0x30).map(c => { try { return parseCert(c.raw); } catch { return null; } }).filter(Boolean) : [];
  // encapsulated content: present for RFC 3161 document time-stamps (TSTInfo)
  const encap = kids(sd[2]), eWrap = encap[1], eContent = eWrap ? kids(eWrap)[0].body : null;
  const si = kids(infos)[0]; if (!si) throw new Error('no signer');
  const f = kids(si);
  let i = 1; const sid = f[i++];
  const hashName = HASH_OIDS[oidStr(kids(f[i++])[0].body)] || 'SHA-256';
  let attrs = null; if (f[i].tag === 0xa0) attrs = f[i++];
  const sigAlg = oidStr(kids(f[i++])[0].body), sig = f[i++].body;
  // signer certificate: issuer + serial, or subject key identifier
  let cert = certs[0];
  if (sid.tag === 0x30) { const [, serial] = kids(sid); cert = certs.find(c => sameBytes(c.serial, serial.body)) || cert; }
  r.cert = cert;
  let md = null;
  if (attrs) for (const a of kids(attrs)) {
    const [t, vals] = kids(a), oid = oidStr(t.body), v = kids(vals)[0];
    if (oid === '1.2.840.113549.1.9.4') md = v.body;
    if (oid === '1.2.840.113549.1.9.5') r.time = asnTime(v);
  }
  if (f.some(n => n.tag === 0xa1)) r.level.push('time-stamped');
  if (eContent && oidStr(encap[0].body) === '1.2.840.113549.1.9.16.1.4') {
    // document time-stamp: TSTInfo carries the hash of the PDF bytes and the time
    r.isTimestamp = true;
    const tst = kids(asn(eContent)), [imprAlg, imprHash] = kids(tst[2]);
    r.time = asnTime(tst[4]);
    r.docsOk = sameBytes(await digest(HASH_OIDS[oidStr(kids(imprAlg)[0].body)] || 'SHA-256', signedData), imprHash.body)
      && (!md || sameBytes(await digest(hashName, eContent), md));
  } else {
    r.docsOk = md ? sameBytes(await digest(hashName, signedData), md) : null;
  }
  if (r.docsOk === false) r.problems.push('The document was changed after this ' + (r.isTimestamp ? 'time-stamp' : 'signature'));
  if (cert) {
    const kind = sigAlg === '1.2.840.113549.1.1.10' ? 'pss' : 'rsa';
    let data = signedData;
    if (attrs) { data = new Uint8Array(attrs.raw); data[0] = 0x31; }   // signature covers the attributes as a SET
    try { r.sigOk = await verifySig(cert, hashName, kind, sig, data); if (!attrs && r.sigOk) r.docsOk = true; }
    catch (e) { r.problems.push('Signature could not be checked (' + e.message + ')'); }
  }
  return r;
}
async function pdfSignatures(docId) {
  const d = S.docs.get(docId); if (!d) return [];
  let hasSig = false;
  try { const fo = await d.pdf.getFieldObjects(); hasSig = !!fo && Object.values(fo).some(arr => arr.some(x => x.type === 'signature')); } catch { }
  if (!hasSig) return [];
  await ensurePdfLib();
  const bytes = await docBytes(docId);
  let ld; try { ld = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, parseSpeed: PDFLib.ParseSpeeds.Fastest }); } catch { return []; }
  const N = n => PDFLib.PDFName.of(n), out = [];
  for (const field of ld.getForm().getFields()) {
    const v = field.acroField.dict.lookup(N('V'));
    if (!(v instanceof PDFLib.PDFDict)) continue;
    const contents = v.lookup(N('Contents')), br = v.lookup(N('ByteRange'));
    if (!contents || !br) continue;
    const hex = contents instanceof PDFLib.PDFHexString ? contents.asString() : null;
    let p7 = hex ? Uint8Array.from(hex.match(/../g) || [], h => parseInt(h, 16)) : contents.asBytes ? contents.asBytes() : null;
    if (!p7 || !p7.length) continue;
    try { p7 = p7.subarray(0, asn(p7).end); } catch { }   // drop the zero padding after the DER
    const ranges = br.asArray().map(n => n.asNumber());
    const parts = []; let total = 0; for (let k = 0; k < ranges.length; k += 2) { parts.push(bytes.subarray(ranges[k], ranges[k] + ranges[k + 1])); total += ranges[k + 1]; }
    const data = new Uint8Array(total); let o = 0; for (const p of parts) { data.set(p, o); o += p.length; }
    let r; try { r = await checkPkcs7(p7, data); } catch (e) { r = { problems: [/empty/.test(e.message) ? 'The signature is empty – signing was not completed' : 'Could not read signature: ' + e.message], level: [] }; }
    const txt = k => { const x = v.lookup(N(k)); return x && x.decodeText ? x.decodeText() : ''; };
    const sub = v.lookup(N('SubFilter')), typ = v.lookup(N('Type'));
    if (String(sub) === '/ETSI.RFC3161' || String(typ) === '/DocTimeStamp') r.isTimestamp = true;
    r.reason = txt('Reason'); r.place = txt('Location'); r.nameHint = txt('Name');
    if (!r.time) { const m = txt('M'); const mm = /D:(\d{4})(\d\d)(\d\d)(\d\d)?(\d\d)?(\d\d)?/.exec(m); if (mm) r.time = new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3], +(mm[4] || 0), +(mm[5] || 0), +(mm[6] || 0))); }
    const end = ranges[ranges.length - 2] + ranges[ranges.length - 1];
    r.coversAll = end >= bytes.length - 2;
    out.push(r);
  }
  return out;
}

/* ---------- presentation ---------- */
function signerName(r) {
  const s = (r.cert && r.cert.subject) || {};
  const name = s.GN && s.SN ? s.GN + ' ' + s.SN : (s.CN || r.nameHint || 'Unknown signer').replace(/,\d{6,}$/, '').replace(/,/g, ' ');
  return name.replace(/\b([A-ZĄČĘĖĮŠŲŪŽÄÖÜÕ])([A-ZĄČĘĖĮŠŲŪŽÄÖÜÕ]+)\b/g, (m, a, b) => a + b.toLowerCase());
}
function personalCode(r) { const sn = r.cert && r.cert.subject && r.cert.subject.serialNumber; if (!sn) return ''; const m = /^(?:PNO|IDC|PAS)[A-Z]{2}-(.+)$/.exec(sn); return m ? m[1] : sn; }
function sigStatus(r) {
  if (r.docsOk === false) return ['bad', 'Document changed after signing'];
  if (r.sigOk === false) return ['bad', 'Signature does not match'];
  if (r.docsOk && r.sigOk) return ['ok', 'Signature valid'];
  return ['unknown', 'Could not be fully checked'];
}
const fmtTime = d => d && !isNaN(d) ? d.toLocaleString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'time unknown';
function sigCard(r) {
  const [cls, label] = sigStatus(r), c = el('div', 'sigCard ' + cls);
  const icon = el('span', 'sigIcon g'); icon.textContent = cls === 'ok' ? '' : cls === 'bad' ? '' : '';
  const body = el('div', 'sigBody');
  const h = el('div', 'sigName'); h.textContent = r.isTimestamp ? 'Document time-stamp – ' + signerName(r) : signerName(r); body.append(h);
  const meta = el('div', 'sigMeta');
  const code = personalCode(r);
  meta.textContent = [fmtTime(r.time), code && 'personal code ' + code, r.place, r.role, r.reason].filter(Boolean).join(' · ');
  body.append(meta);
  const st = el('div', 'sigState'); st.textContent = (r.isTimestamp ? label.replace('Signature', 'Time-stamp') : label) + (r.level && r.level.length ? ' · ' + r.level.join(', ') : '');
  body.append(st);
  const iss = r.cert && r.cert.issuer && (r.cert.issuer.CN || r.cert.issuer.O);
  if (iss) { const i2 = el('div', 'sigMeta'); i2.textContent = 'Certificate issued by ' + iss + (r.cert.subject.C ? ' (' + r.cert.subject.C + ')' : ''); body.append(i2); }
  for (const p of r.problems || []) { const pe = el('div', 'sigProblem'); pe.textContent = p; body.append(pe); }
  if (r.coversAll === false && !r.isTimestamp) { const pe = el('div', 'sigMeta'); pe.textContent = 'Changes were added to the PDF after this signature (e.g. further signatures or form filling).'; body.append(pe); }
  c.append(icon, body);
  return c;
}
const SIG_NOTE = 'Checked on this PC: the documents are unchanged since signing and each signature matches its certificate. Whether the certificate was trusted and not revoked at the time is not checked online.';

// signature containers open in the document view
async function renderContainer(f, inner, ext) {
  const res = await readContainer(await f.arrayBuffer());
  inner.className = '';
  const box = el('div', 'esign');
  const head = el('div', 'esHead');
  const okAll = res.sigs.length && res.sigs.every(s => sigStatus(s)[0] === 'ok');
  head.innerHTML = `<span class="g">${okAll ? '' : ''}</span><div><b></b><span></span></div>`;
  head.querySelector('b').textContent = res.sigs.length ? `${res.sigs.length} signature${res.sigs.length > 1 ? 's' : ''}` + (okAll ? ' – all valid' : '') : 'No signatures in this container';
  head.querySelector(':scope > div > span').textContent = SIG_NOTE;
  if (okAll) head.classList.add('ok');
  box.append(head);
  for (const s of res.sigs) box.append(sigCard(s));
  const dh = el('h3'); dh.textContent = `Signed document${res.docs.length === 1 ? '' : 's'}`; box.append(dh);
  for (const d of res.docs) {
    const row = el('button', 'esDoc');
    row.append(badgeFor(extOf(d.name)));
    const n = el('span', 'rn'); n.textContent = d.name.split('/').pop(); row.append(n);
    const sz = el('span', 'rp'); sz.textContent = (d.bytes.length / 1024).toFixed(0) + ' KB'; row.append(sz);
    const go = el('span', 'esOpen'); go.textContent = 'View'; row.append(go);
    row.addEventListener('click', () => openFromContainer(f, d, res));
    box.append(row);
  }
  inner.append(box);
  // a container with a single document: show the signatures, the document is one click away
}
async function openFromContainer(f, d, res) {
  const name = d.name.split('/').pop();
  Cur.pendingContainer = { name: f.name, sigs: res.sigs, file: f, path: Cur.path };
  await openFiles([new File([d.bytes], name, { type: extOf(name) === 'pdf' ? 'application/pdf' : '' })], null);
}
function showContainerBanner() {
  const fc = Cur.fromContainer; if (!fc) return;
  const ok = fc.sigs.length && fc.sigs.every(s => sigStatus(s)[0] === 'ok');
  const b = $(document.body.dataset.mode === 'pdf' ? '#pdfSigBanner' : '#docSigBanner');
  b.className = 'sigBanner' + (ok ? ' ok' : ' bad');
  b.innerHTML = `<span class="g">${ok ? '' : ''}</span><span class="sbText"></span><button class="sbBack">Back to signatures</button>`;
  b.querySelector('.sbText').textContent = `From "${fc.name}" · signed by ${fc.sigs.map(signerName).join(', ') || 'nobody'}${ok ? ' · valid' : ''}`;
  b.querySelector('.sbBack').onclick = () => { if (fc.path) openPath(fc.path); else openFiles([fc.file], null); };
  b.hidden = false;
}

// signatures inside a PDF: banner + details
async function checkPdfSignatures() {
  const banner = $('#pdfSigBanner'); banner.hidden = true; S.pdfSigs = [];
  if (Cur.fromContainer) { showContainerBanner(); return; }
  const first = S.docs.size ? [...S.docs.keys()][0] : null; if (first == null) return;
  let sigs = [];
  try { sigs = await pdfSignatures(first); } catch (e) { console.warn('pdf signatures', e); }
  S.pdfSigs = sigs;
  if (!sigs.length) return;
  const ok = sigs.every(s => sigStatus(s)[0] === 'ok');
  banner.className = 'sigBanner' + (ok ? ' ok' : sigs.some(s => sigStatus(s)[0] === 'bad') ? ' bad' : '');
  banner.innerHTML = `<span class="g">${ok ? '' : ''}</span><span class="sbText"></span><button class="sbBack">Details</button>`;
  const who = [...new Set(sigs.filter(s => !s.isTimestamp).map(signerName))].join(', ') || 'a time-stamp only';
  banner.querySelector('.sbText').textContent = `Digitally signed by ${who} · ${ok ? 'signature' + (sigs.length > 1 ? 's' : '') + ' valid' : sigStatus(sigs.find(s => sigStatus(s)[0] !== 'ok'))[1].toLowerCase()}`;
  banner.querySelector('.sbBack').onclick = () => {
    const d = $('#sigDlg'), list = d.querySelector('.sigList'); list.textContent = '';
    for (const s of sigs) list.append(sigCard(s));
    d.querySelector('.sigNote').textContent = SIG_NOTE; d.showModal();
  };
  banner.hidden = false;
}
