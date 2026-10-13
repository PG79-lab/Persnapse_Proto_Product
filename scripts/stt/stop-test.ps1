$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$pidPath = Join-Path $projectRoot 'output/stt-integration/server-process.json'
if (!(Test-Path $pidPath)) { Write-Output 'No saved STT server process.'; exit 0 }
$saved = Get-Content -Raw $pidPath | ConvertFrom-Json
$running = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
if (!$running) { Write-Output 'STT server already stopped.'; exit 0 }
$details = Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)"
if ($running.StartTime.ToUniversalTime().Ticks.ToString() -ne $saved.startedAt -or $details.Name -ne 'node.exe' -or $details.CommandLine -notlike '*scripts/stt/serve-test.ts*') { throw 'Saved process does not match the STT server. No process was stopped.' }
Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $saved.pid -and $_.Name -eq 'node.exe' -and $_.CommandLine -match 'next.+start.+3201' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
Stop-Process -Id $saved.pid
Write-Output 'STT test server stopped.'
