# Packs dist\windows\Quizbrew (made by desktop/build.js) into dist\Quizbrew.msix for the Microsoft Store.
#   node desktop/build.js
#   powershell -File desktop\msix\build-msix.ps1
# Needs makeappx.exe from the Windows 10/11 SDK. The Store signs the package itself, so no certificate is
# needed for the upload. store.json holds the name and publisher from Partner Center (Product identity).
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$dist = Join-Path $root 'dist'
$app = Join-Path $dist 'windows\Quizbrew'
$layout = Join-Path $dist 'msix'
$out = Join-Path $dist 'Quizbrew.msix'
if (-not (Test-Path (Join-Path $app 'Quizbrew.exe'))) { throw 'Run node desktop/build.js first.' }

$store = Get-Content (Join-Path $PSScriptRoot 'store.json') -Raw | ConvertFrom-Json
$version = (Get-Content (Join-Path $dist 'version.txt') -Raw).Trim()

if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory $layout | Out-Null
Copy-Item (Join-Path $app '*') $layout -Recurse
New-Item -ItemType Directory (Join-Path $layout 'assets') | Out-Null
foreach ($png in 'Square44x44Logo', 'Square150x150Logo', 'Wide310x150Logo', 'StoreLogo') {
  Copy-Item (Join-Path $root "desktop\assets\$png.png") (Join-Path $layout 'assets')
}

$manifest = Get-Content (Join-Path $PSScriptRoot 'AppxManifest.xml') -Raw
$manifest = $manifest.Replace('{{IDENTITY_NAME}}', $store.identityName).Replace('{{PUBLISHER}}', $store.publisher).Replace('{{PUBLISHER_DISPLAY_NAME}}', $store.publisherDisplayName).Replace('{{VERSION}}', $version)
if ($manifest -match '\{\{') { throw 'AppxManifest.xml still has a {{...}} value.' }
[IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $manifest, (New-Object Text.UTF8Encoding $false))

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe not found: install the Windows SDK.' }
& $makeappx.FullName pack /o /d $layout /p $out
if ($LASTEXITCODE -ne 0) { throw "makeappx failed ($LASTEXITCODE)" }
Write-Host "Done: $out ($version)"
