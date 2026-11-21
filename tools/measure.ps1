# Measures how long the installed viewer takes from launch until the file is shown (window title updated).
param([string]$Exe = "$env:LOCALAPPDATA\Programs\Preview\Preview.exe", [string[]]$Files, [int]$Runs = 3)
foreach ($f in $Files) {
  $path = (Resolve-Path $f).Path; $name = Split-Path $path -Leaf
  $times = foreach ($i in 1..$Runs) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process $Exe -ArgumentList "`"$path`"" -PassThru
    $ok = $false
    while ($sw.ElapsedMilliseconds -lt 20000) {
      Start-Sleep -Milliseconds 15; $p.Refresh()
      if ($p.MainWindowTitle -like "$name*") { $ok = $true; break }
    }
    $ms = $sw.ElapsedMilliseconds
    Start-Sleep -Milliseconds 300
    $p.CloseMainWindow() | Out-Null; Start-Sleep -Milliseconds 700
    Get-Process Preview -ErrorAction SilentlyContinue | Stop-Process -Force   # the app lingers after closing; force a true cold start
    Start-Sleep -Milliseconds 500
    if ($ok) { $ms } else { -1 }
  }
  '{0,-22} {1}' -f $name, ($times -join ' ms, ') + ' ms'
}
