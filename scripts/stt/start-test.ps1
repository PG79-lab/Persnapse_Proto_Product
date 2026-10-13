$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRoot = Join-Path $projectRoot 'output/stt-integration'
$pidPath = Join-Path $runtimeRoot 'server-process.json'
function Wait-SttReady {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3200/' -TimeoutSec 1
      if ($response.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Milliseconds 250
  }
  throw 'STT server did not become ready. Check output/stt-integration/server-errors.log.'
}
if (Test-Path $pidPath) {
  $saved = Get-Content -Raw $pidPath | ConvertFrom-Json
  $running = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
  if ($running -and $running.StartTime.ToUniversalTime().Ticks.ToString() -eq $saved.startedAt) {
    Wait-SttReady
    Write-Output 'STT server ready: http://127.0.0.1:3200/#recordings'
    exit 0
  }
}
if (Get-NetTCPConnection -State Listen -LocalPort 3200,3201 -ErrorAction SilentlyContinue) { throw 'Port 3200 or 3201 is already occupied. Existing processes were not changed.' }
$nodeExecutable = (Get-Command node).Source
$serverProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('--import', 'tsx', 'scripts/stt/serve-test.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'server.log') -RedirectStandardError (Join-Path $runtimeRoot 'server-errors.log') -PassThru
@{ pid = $serverProcess.Id; startedAt = $serverProcess.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding utf8
Wait-SttReady
Write-Output 'STT server ready: http://127.0.0.1:3200/#recordings'
