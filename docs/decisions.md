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
  with its background colour and types the new text on top (`app/pdfedit-core.js`); the old text
  is still in the file and can be found by copying or text extraction.
- **The installer is not code-signed**, so Windows SmartScreen shows a warning the first time
  it runs.

## Markdown (`app/markdown.js`, `app/markdown-view.js`)

- **Own small parser instead of a library.** It covers what notes and READMEs use (headings,
  lists, task lists, quotes, code, tables, links, pictures) without a new dependency.
- **HTML inside a .md file is shown as text, never run.** The app can read local files, so a
  script hidden in a Markdown file must not get a chance to run; links never run `javascript:`.
- **Web pictures are not downloaded.** A picture from the internet could tell its owner who
  opened the file and when; it is shown as a link instead. Local and embedded pictures are shown.
- **Open with only.** The installer offers Preview for `.md` under "Open with" but never makes it
  the default, since people usually edit Markdown in a text editor.

## PDF → Markdown (`app/pdf2md.js`)

- **The structure is guessed from how the text looks**, because a PDF only stores where each
  piece of text is drawn: bigger text is a heading (up to 4 levels by size), lines close together
  are one paragraph, "•" or "1." starts a list item, a typewriter font is code. A long line that
  ends like a sentence is never a heading.
- **Running headers, footers and page numbers are dropped** when the same line is at the top or
  bottom of most pages (3 pages or more); tiny footnote marks (∗, †, 1) are dropped too.
- **Two-column pages are read column by column.** Lines that cross the middle split the page
  into bands, and each band is read left column first.
- **Scanned pages use the recognised OCR text**, so OCR has to run first; without any text the
  export says so instead of saving an empty file.
- **Known limits:** tables come out as plain lines, pictures are left out, bold or italic inside a
  line is lost, and pages with three or more columns are read across.
