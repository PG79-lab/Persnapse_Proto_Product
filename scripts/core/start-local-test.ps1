param([int]$Port = 3510, [switch]$WithIndexWorker)
$ErrorActionPreference = 'Stop'
$coreRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (!(Test-Path -LiteralPath (Join-Path $coreRoot '.next/BUILD_ID'))) { throw 'Run npm run build -- --webpack first.' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is already in use." }
$coreLogs = Join-Path $coreRoot 'output/core-test'
New-Item -ItemType Directory -Force -Path $coreLogs | Out-Null
$nodeExe = (Get-Command node).Source
$server = Start-Process -FilePath $nodeExe -ArgumentList @('node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', "$Port") -WorkingDirectory $coreRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $coreLogs 'server.log') -RedirectStandardError (Join-Path $coreLogs 'server-error.log') -PassThru
$record = @{ serverPid = $server.Id; port = $Port; root = $coreRoot; workerPid = $null }
if ($WithIndexWorker) {
  $worker = Start-Process -FilePath $nodeExe -ArgumentList @('--env-file=.env.local', '--conditions=react-server', '--import', 'tsx', 'scripts/ai/assistant-worker.ts', '--confirm-live', '--watch') -WorkingDirectory $coreRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $coreLogs 'worker.log') -RedirectStandardError (Join-Path $coreLogs 'worker-error.log') -PassThru
  $record.workerPid = $worker.Id
}
$record | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $coreLogs 'processes.json')
Write-Output "http://localhost:$Port/#cards"
Write-Output "http://localhost:$Port/?assistant=1#todos"
