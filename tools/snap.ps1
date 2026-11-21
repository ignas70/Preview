# Launches Preview with a file and saves a screenshot of its window (PrintWindow captures WebView2 content too).
param([string]$File, [string]$Out, [int]$Wait = 2500, [string]$Exe = "$PSScriptRoot\..\build\Preview.exe", [string]$Script, [int]$Width = 1280, [int]$Height = 820)
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace S -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
public struct RECT { public int L, T, R, B; }
'@
[S.W]::SetProcessDPIAware() | Out-Null
if ($Script) { $env:PREVIEW_EVAL = $Script } else { Remove-Item Env:PREVIEW_EVAL -ErrorAction SilentlyContinue }
Get-Process Preview -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 300
$args2 = if ($File) { "`"$((Resolve-Path $File).Path)`"" } else { $null }
$p = if ($args2) { Start-Process $Exe -ArgumentList $args2 -PassThru } else { Start-Process $Exe -PassThru }
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($p.MainWindowHandle -eq [IntPtr]::Zero -and $sw.ElapsedMilliseconds -lt 10000) { Start-Sleep -Milliseconds 50; $p.Refresh() }
$h = $p.MainWindowHandle
[S.W]::ShowWindow($h, 9) | Out-Null
[S.W]::MoveWindow($h, 40, 40, $Width, $Height, $true) | Out-Null
Start-Sleep -Milliseconds $Wait
$r = New-Object S.W+RECT; [S.W]::GetWindowRect($h, [ref]$r) | Out-Null
$f = New-Object S.W+RECT; [S.W]::DwmGetWindowAttribute($h, 9, [ref]$f, 16) | Out-Null   # visible frame (without invisible borders)
$bmp = New-Object Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[S.W]::PrintWindow($h, $dc, 2) | Out-Null
$g.ReleaseHdc($dc); $g.Dispose()
$crop = New-Object Drawing.Rectangle ($f.L - $r.L), ($f.T - $r.T), ($f.R - $f.L), ($f.B - $f.T)
$out2 = $bmp.Clone($crop, $bmp.PixelFormat); $bmp.Dispose()
$out2.Save($Out, [Drawing.Imaging.ImageFormat]::Png); $out2.Dispose()
Remove-Item Env:PREVIEW_EVAL -ErrorAction SilentlyContinue
Write-Host "saved $Out"
