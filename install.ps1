# Installs Preview for the current user (no admin rights) and registers its file types.
param([switch]$NoSettings)
$ErrorActionPreference = 'Stop'
$AppName = 'Preview'
$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA 'Programs\Preview'

if (Get-Process Preview, Perziura -ErrorAction SilentlyContinue) {
  Write-Warning 'Preview is running. Close all of its windows and run the installer again.'
  exit 1
}

# --- remove the earlier Lithuanian build ("Peržiūra" / Perziura) if present ---
$classes = 'HKCU:\Software\Classes'
$oldIds = 'Perziura.PDF', 'Perziura.Word', 'Perziura.Excel', 'Perziura.PowerPoint', 'Perziura.Apple', 'Perziura.Google'
$exts = '.pdf', '.docx', '.docm', '.dotx', '.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.csv', '.pptx', '.ppsx', '.potx', '.pages', '.numbers', '.key', '.gdoc', '.gsheet', '.gslides'
foreach ($e in $exts) {
  foreach ($p in $oldIds) { Remove-ItemProperty -Path "$classes\$e\OpenWithProgids" -Name $p -ErrorAction SilentlyContinue }
  $cur = (Get-ItemProperty -Path "$classes\$e" -Name '(default)' -ErrorAction SilentlyContinue).'(default)'
  if ($oldIds -contains $cur) { Set-Item -Path "$classes\$e" -Value '' }
}
foreach ($p in $oldIds) { Remove-Item "$classes\$p" -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item "$classes\Applications\Perziura.exe" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Perziura' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name 'Peržiūra' -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Perziura' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Peržiūra.lnk') -ErrorAction SilentlyContinue
foreach ($old in (Join-Path $env:LOCALAPPDATA 'Programs\Perziura'), (Join-Path $env:LOCALAPPDATA 'Perziura')) {
  if (Test-Path $old) { Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue }
}

# --- copy files ---
if ((Resolve-Path $src).Path.TrimEnd('\') -ne $dst.TrimEnd('\')) {
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Force $dst | Out-Null
  Copy-Item (Join-Path $src '*') $dst -Recurse -Force
}
$exe = Join-Path $dst 'Preview.exe'
$open = "`"$exe`" `"%1`""

$types = [ordered]@{
  'Preview.PDF'        = @('PDF Document', '.pdf')
  'Preview.Word'       = @('Word Document', '.docx', '.docm', '.dotx', '.doc', '.rtf', '.odt')
  'Preview.Sheet'      = @('Spreadsheet', '.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.csv')
  'Preview.Slides'     = @('Presentation', '.pptx', '.ppsx', '.potx', '.ppt', '.pps', '.odp')
  'Preview.Image'      = @('Image', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')
  'Preview.Apple'      = @('Apple Document', '.pages', '.numbers', '.key')
  'Preview.Google'     = @('Google File Link', '.gdoc', '.gsheet', '.gslides')
  'Preview.Signed'     = @('Signed Container', '.asice', '.sce', '.bdoc', '.adoc', '.edoc')
}

function Set-Key([string]$path, [hashtable]$values) {
  if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
  foreach ($k in $values.Keys) {
    if ($k -eq '(default)') { Set-Item -Path $path -Value $values[$k] }
    else { New-ItemProperty -Path $path -Name $k -Value $values[$k] -PropertyType String -Force | Out-Null }
  }
}

$capsPath = 'HKCU:\Software\Preview\Capabilities'
Set-Key $capsPath @{ ApplicationName = $AppName; ApplicationDescription = 'Fast viewer for PDF, Word, Excel, PowerPoint, Apple and Google files, with PDF signing and editing'; ApplicationIcon = "$exe,0" }
Set-Key "$classes\Applications\Preview.exe" @{ FriendlyAppName = $AppName }
Set-Key "$classes\Applications\Preview.exe\DefaultIcon" @{ '(default)' = "`"$exe`",0" }
Set-Key "$classes\Applications\Preview.exe\shell\open\command" @{ '(default)' = $open }

foreach ($progId in $types.Keys) {
  $desc = $types[$progId][0]; $list = $types[$progId][1..($types[$progId].Count - 1)]
  Set-Key "$classes\$progId" @{ '(default)' = $desc; FriendlyTypeName = $desc }
  Set-Key "$classes\$progId\DefaultIcon" @{ '(default)' = "`"$exe`",0" }
  Set-Key "$classes\$progId\shell\open" @{ FriendlyAppName = $AppName }
  Set-Key "$classes\$progId\shell\open\command" @{ '(default)' = $open }
  foreach ($e in $list) {
    Set-Key "$classes\$e\OpenWithProgids" @{ $progId = '' }
    Set-Key "$capsPath\FileAssociations" @{ $e = $progId }
    Set-Key "$classes\Applications\Preview.exe\SupportedTypes" @{ $e = '' }
    # become the default only for types nothing else opens (e.g. .pages); Windows keeps the user's own choices
    $cur = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$e" -Name '(default)' -ErrorAction SilentlyContinue).'(default)'
    if ([string]::IsNullOrEmpty($cur)) { Set-Item -Path "$classes\$e" -Value $progId }
  }
}
Set-Key 'HKCU:\Software\RegisteredApplications' @{ $AppName = 'Software\Preview\Capabilities' }

$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"
$sh = New-Object -ComObject WScript.Shell
foreach ($l in $lnk, (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk")) {
  $s = $sh.CreateShortcut($l); $s.TargetPath = $exe; $s.WorkingDirectory = $dst; $s.IconLocation = "$exe,0"; $s.Description = 'View documents, sign and edit PDFs'; $s.Save()
}

$un = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Preview'
$size = [int]((Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
Set-Key $un @{
  DisplayName = $AppName; DisplayIcon = "$exe,0"; DisplayVersion = '2.0.0'; Publisher = $AppName
  InstallLocation = $dst; UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$dst\uninstall.ps1`""
}
New-ItemProperty $un -Name EstimatedSize -Value $size -PropertyType DWord -Force | Out-Null
New-ItemProperty $un -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty $un -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "Installed: $exe"
if (-not $NoSettings) { Start-Process ("ms-settings:defaultapps?registeredAppUser=" + $AppName) }
