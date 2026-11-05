# Asks Windows whether this copy of Quizbrew is bought in the Microsoft Store or still the free trial.
# desktop/store.js runs it with Windows PowerShell from inside the Store package (it only works there)
# and reads one line of JSON: {"ok":true,"active":true,"trial":false} or {"ok":false,"error":"..."}.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Services.Store.StoreContext, Windows.Services.Store, ContentType = WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $context = [Windows.Services.Store.StoreContext]::GetDefault()
  $task = $asTask.MakeGenericMethod([Windows.Services.Store.StoreAppLicense]).Invoke($null, @($context.GetAppLicenseAsync()))
  if (-not $task.Wait(20000)) { throw 'The Store did not answer in time.' }
  $license = $task.Result
  [Console]::Out.WriteLine((@{ ok = $true; active = [bool]$license.IsActive; trial = [bool]$license.IsTrial } | ConvertTo-Json -Compress))
} catch {
  [Console]::Out.WriteLine((@{ ok = $false; error = "$_" } | ConvertTo-Json -Compress))
}
