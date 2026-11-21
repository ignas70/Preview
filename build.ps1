# Builds Preview into .\build  (-Setup also makes dist\Preview-<version>-Setup.exe with Inno Setup)
param([switch]$Setup)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$fw = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
$wv = 'pkg\wv2\lib\net462'
$version = (Get-Content version.txt -TotalCount 1).Trim()
# the GitHub repository that updates come from: taken from the git remote ("owner/name")
$repo = 'OWNER/REPO'
try { $u = (& git config --get remote.origin.url 2>$null); if ($u -match 'github\.com[:/]([^/]+/[^/.]+?)(\.git)?$') { $repo = $Matches[1] } } catch { }
if (-not (Test-Path "$wv\Microsoft.Web.WebView2.Core.dll")) {   # WebView2 SDK from NuGet (first build only)
  New-Item -ItemType Directory pkg -Force | Out-Null
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.4314.35' -OutFile pkg\wv2.zip -UseBasicParsing
  Expand-Archive pkg\wv2.zip pkg\wv2 -Force
}
if (-not (Test-Path host\icon.ico)) { & .\host\make-icon.ps1 }
if (Test-Path build) { Remove-Item build -Recurse -Force }
New-Item -ItemType Directory build, obj -Force | Out-Null
@"
[assembly: System.Reflection.AssemblyVersion("$version.0")]
[assembly: System.Reflection.AssemblyFileVersion("$version.0")]
static class BuildInfo { public const string Repo = "$repo"; }
"@ | Set-Content obj\BuildInfo.cs -Encoding UTF8
& "$fw\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /out:build\Preview.exe /win32icon:host\icon.ico `
  /r:"$fw\System.Web.Extensions.dll" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Net.Http.dll /r:System.Core.dll `
  /r:"$wv\Microsoft.Web.WebView2.Core.dll" /r:"$wv\Microsoft.Web.WebView2.WinForms.dll" `
  host\Program.cs host\DocTab.cs host\MainForm.cs host\TabStrip.cs host\Updater.cs obj\BuildInfo.cs
if ($LASTEXITCODE -ne 0) { throw 'Compilation failed' }
Copy-Item "$wv\Microsoft.Web.WebView2.Core.dll", "$wv\Microsoft.Web.WebView2.WinForms.dll", 'pkg\wv2\runtimes\win-x64\native\WebView2Loader.dll' build\
Copy-Item app build\app -Recurse
Copy-Item install.ps1, uninstall.ps1, register-machine.ps1 build\
Write-Host "Built build\Preview.exe $version (updates from $repo)"
if ($Setup) {
  $iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 7\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) { throw 'Inno Setup (ISCC.exe) not found' }
  & $iscc /Q "/DAppVersion=$version" installer.iss
  if ($LASTEXITCODE -ne 0) { throw 'Setup build failed' }
  Write-Host "Built dist\Preview-$version-Setup.exe"
}
