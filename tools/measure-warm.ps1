# Opens files while Preview is already running and measures until a window titled "<file> – Preview" appears.
param([string]$Exe = "$PSScriptRoot\..\build\Preview.exe", [string[]]$Files, [int]$Runs = 3)
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t); [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);'
$anchor = Start-Process $Exe -PassThru; Start-Sleep 2
foreach ($f in $Files) {
  $path = (Resolve-Path $f).Path; $title = (Split-Path $path -Leaf) + ' ' + [char]0x2013 + ' Preview'
  $times = foreach ($i in 1..$Runs) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Start-Process $Exe -ArgumentList "`"$path`"" | Out-Null
    $h = [IntPtr]::Zero
    while ($sw.ElapsedMilliseconds -lt 15000) { $h = [W.U]::FindWindow([NullString]::Value, $title); if ($h -ne [IntPtr]::Zero) { break }; Start-Sleep -Milliseconds 10 }
    $ms = $sw.ElapsedMilliseconds
    Start-Sleep -Milliseconds 400
    [W.U]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; Start-Sleep -Milliseconds 600
    $ms
  }
  '{0,-22} {1}' -f (Split-Path $path -Leaf), ($times -join ' ms, ') + ' ms'
}
$anchor.CloseMainWindow() | Out-Null
