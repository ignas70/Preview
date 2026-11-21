# Removes Preview and all of its registrations.
$AppName = 'Preview'
$dst = Join-Path $env:LOCALAPPDATA 'Programs\Preview'
$classes = 'HKCU:\Software\Classes'
Get-Process Preview -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Milliseconds 800

$progIds = 'Preview.PDF', 'Preview.Word', 'Preview.Sheet', 'Preview.Slides', 'Preview.Apple', 'Preview.Google', 'Preview.Image'
$exts = '.pdf', '.docx', '.docm', '.dotx', '.doc', '.rtf', '.odt', '.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.csv', '.pptx', '.ppsx', '.potx', '.ppt', '.pps', '.odp', '.pages', '.numbers', '.key', '.gdoc', '.gsheet', '.gslides', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Preview' -ErrorAction SilentlyContinue
foreach ($e in $exts) {
  foreach ($p in $progIds) { Remove-ItemProperty -Path "$classes\$e\OpenWithProgids" -Name $p -ErrorAction SilentlyContinue }
  $cur = (Get-ItemProperty -Path "$classes\$e" -Name '(default)' -ErrorAction SilentlyContinue).'(default)'
  if ($progIds -contains $cur) { Set-Item -Path "$classes\$e" -Value '' }
}
foreach ($p in $progIds) { Remove-Item "$classes\$p" -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item "$classes\Applications\Preview.exe" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Preview' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name $AppName -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Preview' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk") -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk") -ErrorAction SilentlyContinue

# machine-wide entries from register-machine.ps1 (only if present; asks for admin rights)
if ((Get-ItemProperty 'HKLM:\SOFTWARE\RegisteredApplications' -ErrorAction SilentlyContinue).Preview -and (Test-Path "$dst\register-machine.ps1")) {
  Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$dst\register-machine.ps1`"", '-Remove'
}

Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

# the app folder and its data (browser cache, saved signatures) are deleted a few seconds later
$data = Join-Path $env:LOCALAPPDATA 'Preview'
Start-Process cmd.exe -WindowStyle Hidden -ArgumentList "/c timeout /t 3 /nobreak >nul & rmdir /s /q `"$dst`" & rmdir /s /q `"$data`""
Write-Host 'Preview has been removed.'
