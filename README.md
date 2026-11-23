# Preview

A fast document viewer for Windows that can also edit and sign PDFs, similar to iLovePDF but offline.

**Download:** get `Preview-x.y.z-Setup.exe` from the [latest release](../../releases/latest). Once installed, Preview updates itself from this repository's releases.

## What it opens

| Kind | Formats |
|---|---|
| PDF | `.pdf`, including password-protected files, forms and very large files (loaded in ranges); export to Markdown |
| Word | `.docx` `.docm` `.dotx`, older `.doc` `.rtf` `.odt` |
| Spreadsheets | `.xlsx` `.xlsm` `.xlsb` `.xls` `.ods` `.csv`, with cell styles and charts |
| Presentations | `.pptx` `.ppsx` `.potx`, older `.ppt` `.pps` `.odp`, with full-screen presenting |
| Apple | `.pages` `.numbers` `.key` |
| Google | `.gdoc` `.gsheet` `.gslides` (downloads the document behind the link) |
| E-signatures | `.asice` `.bdoc` `.adoc` `.edoc` `.sce` containers (Smart-ID, Mobile-ID, ID card), and digitally signed PDFs |
| Images | `.jpg` `.png` `.gif` `.webp` `.bmp` |
| Text | `.md` (shown formatted), `.txt` `.log` `.json` `.xml` `.ini` |

## PDF editing

- Add text, signatures (drawn or typed), images, highlights, drawings, white-out and sticky notes. Text, highlights, drawings and notes are saved as real PDF comments.
- **Edit text:** edit the PDF's own text. Click a line and retype it; the font, size and colour are matched.
- **Stamp:** add today's date, your name or your initials with one click.
- Reorder, rotate, delete and extract pages, merge PDFs, insert blank pages, turn images into a PDF.
- Fill in forms, compress, flatten, print, find text, and use OCR to make scanned pages searchable (Lithuanian and English).
- Night reading mode inverts pages but keeps pictures in their real colours.

## Electronic signatures

Preview lists every signer, the signing time and the signed documents. It also checks two things on your PC:

- that the documents were not changed after signing;
- that each signature matches its certificate.

It does not check online whether the certificate was trusted and not revoked at the time. Use the official DigiDoc4 or Dokobit tools when that legal-grade validation matters.

## Building

You need Windows 10/11, the .NET Framework 4.8 compiler (part of Windows) and the WebView2 runtime. [Inno Setup](https://jrsoftware.org/isinfo.php) is needed only for the installer.

```powershell
.\build.ps1          # app in .\build (downloads the WebView2 SDK on the first build)
.\build.ps1 -Setup   # also dist\Preview-<version>-Setup.exe
```

To publish a release, bump `version.txt`, run `.\build.ps1 -Setup`, then upload the setup:

```powershell
gh release create v2.2.0 dist\Preview-2.2.0-Setup.exe --title "Preview 2.2.0" --notes "..."
```

The repository that updates come from is taken from the git remote at build time.

## Layout

- `host/` holds the C# WinForms + WebView2 shell: windows, tabs, file access, the single instance and the updater.
- `app/` holds the viewer UI (HTML/JS). `app/lib/` contains third-party libraries:
  - pdf.js, pdf-lib (cantoo fork), fontkit, docx-preview, SheetJS, ExcelJS, pptx-preview, JSZip, Tesseract.js.
  - Fonts: DejaVu Sans and Dancing Script.
  - Each library keeps its own license.
- `tools/` contains measurement and screenshot scripts plus the automated UI tests (`tools/tests/*.js`, run through `PREVIEW_EVAL`).
