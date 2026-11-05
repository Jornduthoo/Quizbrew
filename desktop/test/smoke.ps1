# Used by .github/workflows/windows.yml: wait until Quizbrew answers with its quizmaster page.
function Wait-Quizbrew([int]$Port = 3001, [int]$Seconds = 60) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      $r = Invoke-WebRequest "http://127.0.0.1:$Port/host" -UseBasicParsing -TimeoutSec 2
      if ($r.Content -match '<title>Quizbrew') { Write-Host "Quizbrew answers on port $Port"; return }
    } catch { }
    Start-Sleep 1
  }
  throw "Quizbrew did not answer on port $Port"
}
