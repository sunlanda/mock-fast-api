param(
  [int]$WaitSeconds = 45,
  [int]$DebugPort = 9230
)

$ErrorActionPreference = "Stop"
$desktop = Resolve-Path (Join-Path $PSScriptRoot "..")
$exe = Join-Path $desktop "release\win-unpacked\MockFast.exe"
$appData = Join-Path $env:APPDATA "MockFast"
$logDir = Join-Path $desktop ".smoke-logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$stdout = Join-Path $logDir "electron.stdout.log"
$stderr = Join-Path $logDir "electron.stderr.log"
Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue

function Write-Summary([string]$title, [string[]]$lines) {
  Write-Host "=== $title ==="
  $lines | ForEach-Object { Write-Host $_ }
  if ($env:GITHUB_STEP_SUMMARY) {
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "## $title" -Encoding utf8
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value '```text' -Encoding utf8
    $lines | Add-Content -Path $env:GITHUB_STEP_SUMMARY -Encoding utf8
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value '```' -Encoding utf8
  }
}

if (-not (Test-Path $exe)) {
  throw "Missing packaged executable: $exe"
}

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$app = Start-Process -FilePath $exe -ArgumentList @(
  "--headless", "--no-sandbox", "--disable-gpu",
  "--remote-debugging-port=$DebugPort", "--enable-logging"
) -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr

$target = $null
try {
  for ($i = 0; $i -lt $WaitSeconds; $i++) {
    Start-Sleep -Seconds 1
    if ($app.HasExited) {
      throw "MockFast.exe exited early with code $($app.ExitCode)"
    }
    try {
      $targets = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json" -TimeoutSec 2
      $target = $targets | Where-Object { $_.url -like "http://127.0.0.1:*" } | Select-Object -First 1
      if ($target) { break }
    } catch {
      # Electron/DevTools may not be ready yet.
    }
  }

  if (-not $target) {
    throw "Electron did not load a local MockFast URL within $WaitSeconds seconds"
  }

  Write-Host "Desktop page: $($target.url)"
  $response = Invoke-WebRequest -Uri $target.url -UseBasicParsing -TimeoutSec 10
  if ($response.Content -notmatch "MockFast") {
    throw "Desktop page did not contain the MockFast UI"
  }

  $health = Invoke-RestMethod -Uri (($target.url -replace "/$", "") + "/api/health") -TimeoutSec 10
  if (-not $health.ok) {
    throw "Backend health check did not return ok=true"
  }

  Write-Host "Desktop smoke OK: $($target.url) version=$($health.version)"
} catch {
  $lines = @()
  $lines += "Error: $($_.Exception.Message)"
  $lines += ""
  foreach ($file in @("$appData\startup.log", "$appData\backend.log", $stderr, $stdout)) {
    if (Test-Path $file) {
      $lines += "--- $file ---"
      $lines += (Get-Content $file -Tail 120 -ErrorAction SilentlyContinue)
    }
  }
  if (Test-Path "$appData") {
    $lines += "--- $appData ---"
    $lines += (Get-ChildItem "$appData" -Recurse -Force -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName)
  }
  $lines += "--- processes ---"
  $lines += (Get-Process MockFast, mockfast-backend -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName | Format-Table | Out-String)
  Write-Summary "Desktop smoke failed" $lines
  throw
} finally {
  if ($app -and -not $app.HasExited) {
    taskkill /PID $app.Id /T /F 2>$null | Out-Null
  }
  Get-Process mockfast-backend -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
