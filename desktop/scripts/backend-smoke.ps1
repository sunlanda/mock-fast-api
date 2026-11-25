$ErrorActionPreference = "Stop"
$desktop = Resolve-Path (Join-Path $PSScriptRoot "..")
$exe = Join-Path $desktop "backend\dist\mockfast-backend.exe"
$data = Join-Path $env:RUNNER_TEMP "mockfast-backend-smoke"
$logDir = Join-Path $desktop ".smoke-logs"
New-Item -ItemType Directory -Force $data, $logDir | Out-Null
$stdout = Join-Path $logDir "backend.stdout.log"
$stderr = Join-Path $logDir "backend.stderr.log"
$port = 8799
Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $exe)) {
  throw "Missing backend executable: $exe"
}

function Show-Failure([string]$message) {
  Write-Host "=== Backend smoke failed ==="
  Write-Host $message
  $details = @()
  foreach ($file in @($stdout, $stderr)) {
    if (Test-Path $file) {
      $details += "--- $file ---"
      $details += (Get-Content $file -Tail 120 -ErrorAction SilentlyContinue)
    }
  }
  $details | ForEach-Object { Write-Host $_ }
  if ($env:GITHUB_STEP_SUMMARY) {
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "## Backend smoke failed" -Encoding utf8
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value '```text' -Encoding utf8
    $details | Add-Content -Path $env:GITHUB_STEP_SUMMARY -Encoding utf8
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value '```' -Encoding utf8
  }
  $annotation = ($details -join " | " -replace "`r?`n", " ")
  $annotation = $annotation.Substring(0, [Math]::Min(900, $annotation.Length))
  Write-Host "::error title=Backend smoke failed::$message || $annotation"
}

$env:MOCKFAST_DATA_DIR = $data
$env:MOCKFAST_HOST = "127.0.0.1"
$env:MOCKFAST_PORT = "$port"
$app = Start-Process -FilePath $exe -ArgumentList @("--port", "$port") -PassThru `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr

try {
  $health = $null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if ($app.HasExited) { break }
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2 -NoProxy
      if ($health.ok) { break }
    } catch {
      # server still starting
    }
  }
  if ($app.HasExited -or -not $health -or -not $health.ok) {
    Show-Failure "Backend did not become healthy (exited=$($app.HasExited))"
    exit 1
  }
  Write-Host "Backend smoke OK: version=$($health.version) port=$port"
} finally {
  if ($app -and -not $app.HasExited) {
    taskkill /PID $app.Id /T /F 2>$null | Out-Null
  }
}
