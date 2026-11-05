; The Quizbrew installer for Windows (Inno Setup 6), downloadable from quizbrew.app.
; Packs dist\windows\Quizbrew (made by desktop/build.js) into dist\Quizbrew-Setup.exe:
;   node desktop/build.js
;   iscc /DAppVersion=0.1.0.0 desktop\installer.iss
; It installs to Program Files, adds Start menu and desktop shortcuts, and lets phones in through the
; Windows firewall (only Quizbrew.exe, only ports 3001-3010). Quizzes and settings live in
; %LOCALAPPDATA%\Quizbrew and stay when Quizbrew is updated or removed.

#ifndef AppVersion
  #define AppVersion "0.1.0.0"
#endif

[Setup]
; Never change the AppId: Windows uses it to find the installed Quizbrew for updates and removal.
AppId={{090BD659-F898-4347-95FE-9922FDED6673}
AppName=Quizbrew
AppVersion={#AppVersion}
AppVerName=Quizbrew
AppPublisher=Quizbrew
AppPublisherURL=https://quizbrew.app
AppSupportURL=https://quizbrew.app
AppContact=hello@quizbrew.app
VersionInfoVersion={#AppVersion}
VersionInfoProductName=Quizbrew
VersionInfoDescription=Quizbrew installer
DefaultDirName={autopf}\Quizbrew
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir=..\dist
OutputBaseFilename=Quizbrew-Setup
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\Quizbrew.exe
UninstallDisplayName=Quizbrew
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
; Admin rights are needed for the firewall rule that lets the phones in.
PrivilegesRequired=admin
WizardStyle=modern
ShowLanguageDialog=auto
CloseApplications=force
RestartApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "nl"; MessagesFile: "compiler:Languages\Dutch.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[CustomMessages]
en.Firewall=Letting phones connect through the Windows firewall...
nl.Firewall=Gsm's toegang geven via de Windows-firewall...
fr.Firewall=Autorisation des téléphones dans le pare-feu Windows...
de.Firewall=Handys durch die Windows-Firewall zulassen...
es.Firewall=Permitiendo los móviles en el cortafuegos de Windows...

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; An update replaces the code completely, so no old file stays behind. The quizzes are not in here.
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "..\dist\windows\Quizbrew\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Quizbrew"; Filename: "{app}\Quizbrew.exe"; IconFilename: "{app}\Quizbrew.ico"
Name: "{autodesktop}\Quizbrew"; Filename: "{app}\Quizbrew.exe"; IconFilename: "{app}\Quizbrew.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Quizbrew"""; Flags: runhidden; StatusMsg: "{cm:Firewall}"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Quizbrew"" dir=in action=allow program=""{app}\Quizbrew.exe"" protocol=TCP localport=3001-3010 profile=any enable=yes"; Flags: runhidden; StatusMsg: "{cm:Firewall}"
Filename: "{app}\Quizbrew.exe"; Description: "{cm:LaunchProgram,Quizbrew}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Quizbrew"""; Flags: runhidden; RunOnceId: "QuizbrewFirewall"
