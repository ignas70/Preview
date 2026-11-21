; Preview installer (Inno Setup 6/7).  Built by:  .\build.ps1 -Setup
#define AppName "Preview"
#define AppExe "Preview.exe"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{A5837084-DBE1-485A-817D-60178B309C9F}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Preview
AppComments=Fast viewer for PDF, Word, Excel, PowerPoint, Apple, Google and signed files, with PDF editing and signing
VersionInfoVersion={#AppVersion}
; per user by default (no admin prompt, same folder as before: %LOCALAPPDATA%\Programs\Preview);
; "Install for all users" can be chosen in the first dialog
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir=dist
OutputBaseFilename=Preview-{#AppVersion}-Setup
SetupIconFile=host\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "lithuanian"; MessagesFile: "compiler:Languages\Lithuanian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startup"; Description: "Start with Windows (files open instantly)"; GroupDescription: "Options:"; Flags: unchecked

[Files]
Source: "build\*"; DestDir: "{app}"; Excludes: "install.ps1,uninstall.ps1,register-machine.ps1"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; files of the app folder from older versions
Type: filesandordirs; Name: "{app}\app"
Type: files; Name: "{app}\install.ps1"
Type: files; Name: "{app}\uninstall.ps1"
Type: files; Name: "{app}\register-machine.ps1"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "View documents, sign and edit PDFs"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; the uninstall entry of the earlier script-based install (replaced by this installer's own)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\Preview"; ValueType: none; Flags: deletekey
; start with Windows (Preview also changes this from its settings)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Preview"; ValueData: """{app}\{#AppExe}"" --background"; Tasks: startup
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "Preview"; Flags: uninsdeletevalue dontcreatekey
; "Default apps" registration
Root: HKA; Subkey: "Software\Preview"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Preview\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "{#AppName}"
Root: HKA; Subkey: "Software\Preview\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Fast viewer for PDF, Word, Excel, PowerPoint, Apple, Google and signed files, with PDF signing and editing"
Root: HKA; Subkey: "Software\Preview\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "{#AppName}"; ValueData: "Software\Preview\Capabilities"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#AppName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",0"
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""
; file types (generated list: one ProgID per kind of file)
#include "installer-assoc.iss"

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
; after an automatic update (silent install) Preview starts again
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: WizardSilent

[Code]
// Preview keeps running in the background (start with Windows, or a few minutes after the last
// window closes), so it is stopped before files are replaced or removed.
procedure StopPreview();
var Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(300);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopPreview();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopPreview();
  Result := True;
end;

// a file type becomes Preview's by default only when no other app has claimed it (e.g. .pages, .asice);
// Windows keeps the user's own choices for everything else
function NoHandler(Ext: String): Boolean;
var V: String;
begin
  Result := not RegQueryStringValue(HKCR, Ext, '', V) or (V = '') or (Pos('Preview.', V) = 1);
end;
