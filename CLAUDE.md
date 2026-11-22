# Preview

Fast document viewer and PDF editor for Windows (PDF, Office, images; PDF editing, e-signatures, OCR).

## Stack
- `host/`: C# WinForms shell with WebView2 (.NET Framework 4.8, compiled by `build.ps1` with the csc that ships with Windows; no Visual Studio, no dotnet SDK).
- `app/`: viewer UI in plain HTML/JS/CSS, no bundler, no npm.
- `app/lib/`: third-party libraries (pdf.js, pdf-lib cantoo fork, SheetJS, ExcelJS, Tesseract.js, ...). Vendored: never edit, never read whole.
- Installer: Inno Setup (`installer.iss`, `installer-assoc.iss`).

## Commands (PowerShell, from repo root)
- Build app: `.\build.ps1` -> `build\Preview.exe` (downloads the WebView2 SDK on the first build).
- Build installer: `.\build.ps1 -Setup` -> `dist\Preview-<version>-Setup.exe`.
- Run: `.\build\Preview.exe <file>`.
- All UI tests: `.\tools\run-tests.ps1` (or `-Only <name>`), after `.\build.ps1`. Each test in
  `tools\tests` uses `check(name, ok, detail)` from `_harness.js`; prints PASS/FAIL, exit code =
  failures. Needs the local `testfiles\` folder.
- One test / screenshot: `.\tools\snap.ps1 -File <doc> -Out <png> -Script tools\tests\<name>.js`
  (sets `PREVIEW_EVAL`, which `host/DocTab.cs` runs after the page loads). Set `PREVIEW_TRACE=1`
  to get `mark()` results in `%LOCALAPPDATA%\Preview\trace.txt`. In PowerShell put the
  `PREVIEW_EVAL` value in single quotes (double quotes expand `$()`).
- Timing: `tools\measure.ps1` (cold) and `tools\measure-warm.ps1`. Measure, don't assume.
- Install for me (per-user, HKCU file types): `build\install.ps1`. A security product blocks
  HKLM ProgIDs, so Settings can't list Preview as a default app (see `register-machine.ps1`).
- Browser preview of `app/`: launch config `preview-web` in `C:\Dev\.claude\launch.json`.
- Release (ask first, outward-facing): bump `version.txt`, `.\build.ps1 -Setup`, then
  `gh release create v<ver> dist\Preview-<ver>-Setup.exe --title "Preview <ver>" --notes "..."`.

## Never read or search
- `build/`, `dist/`, `obj/`, `pkg/` (build output, ~90 MB).
- `app/lib/` (vendored libraries) except a targeted grep.
- `testfiles/` (sample documents, may be private).

## Conventions
- UI is English and must look like my other apps (Shot, APFS Reader): see "My desktop apps"
  in the global CLAUDE.md.
- Keep `app/` dependency-free: no npm, no build step for the UI.
- One feature per commit; version lives in `version.txt`.

## Gotchas
- `snap.ps1` kills any running `Preview.exe` before it starts.
- The updater reads the GitHub repo from the git remote at build time.
- `*.png` is git-ignored except under `app/`.
