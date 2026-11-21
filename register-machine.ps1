# Registers Preview machine-wide (HKLM) so it appears in Settings > Apps > Default apps > "Set defaults for applications".
# Needs administrator rights. Use -Remove to undo. The file types themselves stay registered per user (HKCU).
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:PUBLIC 'preview-register.log'
trap { ("$(Get-Date -f s) line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)") | Out-File $log -Append; exit 1 }
$caps ='HKLM:\SOFTWARE\Preview\Capabilities'
if ($Remove) {
  Remove-ItemProperty 'HKLM:\SOFTWARE\RegisteredApplications' -Name 'Preview' -ErrorAction SilentlyContinue
  Remove-Item 'HKLM:\SOFTWARE\Preview' -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($id in 'Preview.PDF', 'Preview.Word', 'Preview.Sheet', 'Preview.Slides', 'Preview.Apple', 'Preview.Google') { Remove-Item "HKLM:\SOFTWARE\Classes\$id" -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Host 'Machine-wide registration removed.'
  exit 0
}
$userCaps = 'HKCU:\Software\Preview\Capabilities'
if (-not (Test-Path $userCaps)) { throw 'Preview is not installed for this user. Run install.ps1 first.' }
New-Item -Path "$caps\FileAssociations" -Force | Out-Null
foreach ($n in 'ApplicationName', 'ApplicationDescription', 'ApplicationIcon') {
  New-ItemProperty -Path $caps -Name $n -Value (Get-ItemProperty $userCaps).$n -PropertyType String -Force | Out-Null
}
$fa = Get-Item "$userCaps\FileAssociations"
foreach ($ext in $fa.Property) { New-ItemProperty -Path "$caps\FileAssociations" -Name $ext -Value $fa.GetValue($ext) -PropertyType String -Force | Out-Null }
# Windows only lists apps whose file-type entries (ProgIDs) are registered machine-wide too
foreach ($id in ($fa.Property | ForEach-Object { $fa.GetValue($_) } | Sort-Object -Unique)) {
  $src = Get-Item "HKCU:\Software\Classes\$id"
  $dst = "HKLM:\SOFTWARE\Classes\$id"
  New-Item -Path $dst -Force | Out-Null
  Set-Item -Path $dst -Value $src.GetValue('')
  New-ItemProperty -Path $dst -Name FriendlyTypeName -Value $src.GetValue('FriendlyTypeName') -PropertyType String -Force | Out-Null
  New-Item -Path "$dst\DefaultIcon" -Force | Out-Null; Set-Item -Path "$dst\DefaultIcon" -Value (Get-Item "HKCU:\Software\Classes\$id\DefaultIcon").GetValue('')
  New-Item -Path "$dst\shell\open\command" -Force | Out-Null
  New-ItemProperty -Path "$dst\shell\open" -Name FriendlyAppName -Value 'Preview' -PropertyType String -Force | Out-Null
  Set-Item -Path "$dst\shell\open\command" -Value (Get-Item "HKCU:\Software\Classes\$id\shell\open\command").GetValue('')
}
New-ItemProperty 'HKLM:\SOFTWARE\RegisteredApplications' -Name 'Preview' -Value 'SOFTWARE\Preview\Capabilities' -PropertyType String -Force | Out-Null
Add-Type -Namespace W -Name S -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);'
[W.S]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Host 'Preview registered machine-wide.'
