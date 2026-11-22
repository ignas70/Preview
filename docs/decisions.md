# Decisions and known limits

Why Preview behaves the way it does, so later changes keep these choices on purpose.

## Signature checks (`app/esign-verify.js`)

- **Self-made certificates are not valid signatures.** A certificate that names itself as its
  issuer was made by the signer, so the name inside it proves nothing. Such a signature is shown
  as "intact, but the name is not confirmed", never as valid (`certTrustNote` returns
  `self-made`, `app/esign.js` picks the status).
- **Test certificates are only flagged.** Certificates whose issuer contains "test" (for
  example "TEST of ESTEID-SK 2015") still go through the normal check, but the result says it
  is a test certificate, not a real signature.
- **Changes after the last PDF signature are judged by what was appended** (`changesAfter`):
  - nothing appended: fine;
  - only long-term validation data (`/DSS`, added on purpose by PAdES-LT): allowed;
  - pages, comments or form values touched: warning "the PDF was changed after the last
    signature";
  - appended data packed in object streams, so it can't be read: warning "later additions to
    the PDF could not be checked".

## Known limits

- **No online certificate check.** Preview checks that each signature matches its certificate
  and the signed data, but not whether the certificate was trusted and not revoked at signing
  time. For legal-grade validation use DigiDoc4 or Dokobit (also stated in the README).
- **Simplified XML signature check.** The XAdES/ASiC check (`.asice`, `.bdoc`) is a reduced
  version of the XML signature rules, enough for the EU DSS and DigiDoc samples in
  `testfiles\`, not a full implementation.
- **Edit text keeps the original underneath.** Editing a line of the PDF's own text covers it
  with its background colour and types the new text on top (`app/pdfedit.js`); the old text
  is still in the file and can be found by copying or text extraction.
- **The installer is not code-signed**, so Windows SmartScreen shows a warning the first time
  it runs.
