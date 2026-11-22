# Runs the UI tests in tools\tests inside the built app and prints PASS / FAIL for each check.
#   .\tools\run-tests.ps1              all tests
#   .\tools\run-tests.ps1 -Only esign  tests whose file name contains "esign"
# A test may start with a line "// open: <file in testfiles>" to open that file first.
# Exit code = number of failed checks (0 = everything passed).
param([string]$Only, [string]$Exe = "$PSScriptRoot\..\build\Preview.exe", [int]$Timeout = 120)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\.."
$testfiles = Join-Path $root 'testfiles\'
$trace = Join-Path $env:LOCALAPPDATA 'Preview\trace.txt'
if (-not (Test-Path $Exe)) { throw "Build first: $Exe not found" }
$Exe = (Resolve-Path $Exe).Path

# the installed copy may be running in the background; it is restarted at the end
$installed = Get-Process Preview -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -ne $Exe } | Select-Object -First 1 -ExpandProperty Path

$prelude = "const TESTFILES = '" + $testfiles.Replace('\', '\\') + "';`n" + (Get-Content "$PSScriptRoot\tests\_harness.js" -Raw -Encoding UTF8)
$tests = Get-ChildItem "$PSScriptRoot\tests\*.js" | Where-Object { $_.Name -notlike '_*' -and (-not $Only -or $_.Name -like "*$Only*") }
$failed = 0; $passed = 0
foreach ($t in $tests) {
  $src = Get-Content $t.FullName -Raw -Encoding UTF8
  $open = $null
  if ($src -match '(?m)^// open: (.+?)\s*$') { $open = Join-Path $testfiles $Matches[1] }
  Get-Process Preview -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 400
  Remove-Item $trace -ErrorAction SilentlyContinue
  $env:PREVIEW_TRACE = '1'; $env:PREVIEW_EVAL = $prelude + "`n" + $src
  if ($open) { Start-Process $Exe -ArgumentList "`"$open`"" | Out-Null } else { Start-Process $Exe | Out-Null }
  $sw = [Diagnostics.Stopwatch]::StartNew(); $done = $false
  while ($sw.Elapsed.TotalSeconds -lt $Timeout) {
    Start-Sleep -Milliseconds 300
    if ((Test-Path $trace) -and (Select-String -Path $trace -Pattern 'page: DONE' -Quiet)) { $done = $true; break }
  }
  Write-Host "== $($t.BaseName)" -ForegroundColor Cyan
  $lines = if (Test-Path $trace) { Get-Content $trace -Encoding UTF8 } else { @() }
  foreach ($l in $lines) {
    if ($l -match 'page: (PASS|FAIL) (.*?)( @\d+ms)?$') {
      if ($Matches[1] -eq 'PASS') { $passed++; Write-Host "  PASS $($Matches[2])" -ForegroundColor Green }
      else { $failed++; Write-Host "  FAIL $($Matches[2])" -ForegroundColor Red }
    }
  }
  if (-not $done) { $failed++; Write-Host "  FAIL did not finish within $Timeout s" -ForegroundColor Red }
}
Remove-Item Env:PREVIEW_EVAL, Env:PREVIEW_TRACE -ErrorAction SilentlyContinue
Get-Process Preview -ErrorAction SilentlyContinue | Stop-Process -Force
if ($installed) { Start-Process $installed -ArgumentList '--background' }
Write-Host ''
Write-Host "$passed passed, $failed failed" -ForegroundColor $(if ($failed) { 'Red' } else { 'Green' })
exit $failed
