# Minimal static file server for previewing app/ in a browser (no install needed).
# Usage: .\tools\serve.ps1 [-Root <folder>] [-Port 8766]
# "/" redirects to /app/index.html. Stop with Ctrl+C or by closing the process.
param([string]$Root = (Split-Path $PSScriptRoot -Parent), [int]$Port = 8766)

$Root = (Resolve-Path $Root).Path
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'; '.wasm' = 'application/wasm'; '.ttf' = 'font/ttf'; '.woff2' = 'font/woff2'; '.pdf' = 'application/pdf'
}
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $res.Redirect('/app/index.html'); continue }
      $path = [IO.Path]::GetFullPath((Join-Path $Root $rel))
      if (-not $path.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $path -PathType Leaf)) {
        $res.StatusCode = 404; continue
      }
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($path)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { $res.StatusCode = 500 } finally { $res.Close() }
  }
} finally { $listener.Stop() }
