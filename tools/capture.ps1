# Saves a screenshot of the running Preview window (PrintWindow also captures the WebView2 content).
param([string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace C -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
public struct RECT { public int L, T, R, B; }
'@
[C.W]::SetProcessDPIAware() | Out-Null
$p = Get-Process Preview | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
$h = $p.MainWindowHandle
$r = New-Object C.W+RECT; [C.W]::GetWindowRect($h, [ref]$r) | Out-Null
$f = New-Object C.W+RECT; [C.W]::DwmGetWindowAttribute($h, 9, [ref]$f, 16) | Out-Null
$bmp = New-Object Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc(); [C.W]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc); $g.Dispose()
$crop = New-Object Drawing.Rectangle ($f.L - $r.L), ($f.T - $r.T), ($f.R - $f.L), ($f.B - $f.T)
$o2 = $bmp.Clone($crop, $bmp.PixelFormat); $bmp.Dispose(); $o2.Save($Out, [Drawing.Imaging.ImageFormat]::Png); $o2.Dispose()
