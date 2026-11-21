param([string]$Out = "$PSScriptRoot\icon.ico")
Add-Type -AssemblyName System.Drawing

function New-Png([int]$s) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  $r = $s * 0.22; $m = [Math]::Max(1, $s * 0.04); $w = $s - 2 * $m
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($m, $m, $r, $r, 180, 90); $path.AddArc($m + $w - $r, $m, $r, $r, 270, 90)
  $path.AddArc($m + $w - $r, $m + $w - $r, $r, $r, 0, 90); $path.AddArc($m, $m + $w - $r, $r, $r, 90, 90); $path.CloseFigure()
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.PointF]::new(0, 0)), ([System.Drawing.PointF]::new($s, $s)), ([System.Drawing.Color]::FromArgb(59, 130, 246)), ([System.Drawing.Color]::FromArgb(29, 78, 216))
  $g.FillPath($br, $path)
  # white page with folded corner
  $px = $s * 0.27; $py = $s * 0.18; $pw = $s * 0.46; $ph = $s * 0.62; $f = $s * 0.14
  $page = New-Object System.Drawing.Drawing2D.GraphicsPath
  $page.AddLines([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($px, $py), [System.Drawing.PointF]::new($px + $pw - $f, $py),
    [System.Drawing.PointF]::new($px + $pw, $py + $f), [System.Drawing.PointF]::new($px + $pw, $py + $ph),
    [System.Drawing.PointF]::new($px, $py + $ph)))
  $page.CloseFigure()
  $g.FillPath([System.Drawing.Brushes]::White, $page)
  $fold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(191, 210, 255))
  $g.FillPolygon($fold, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new($px + $pw - $f, $py), [System.Drawing.PointF]::new($px + $pw - $f, $py + $f), [System.Drawing.PointF]::new($px + $pw, $py + $f)))
  if ($s -ge 24) {
    $lw = [Math]::Max(1.5, $s * 0.045)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(37, 99, 235)), $lw
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    foreach ($i in 0..2) { $y = $py + $ph * (0.42 + $i * 0.17); $g.DrawLine($pen, $px + $pw * 0.18, $y, $px + $pw * ($(if ($i -eq 2) { 0.6 } else { 0.82 })), $y) }
  }
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  return , $ms.ToArray()
}

$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$pngs = foreach ($s in $sizes) { , (New-Png $s) }
$fs = [System.IO.File]::Create($Out); $bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $d = $pngs[$i]
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))); $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$d.Length); $bw.Write([UInt32]$offset); $offset += $d.Length
}
foreach ($d in $pngs) { $bw.Write($d) }
$bw.Close()
Write-Host "Icon: $Out"
