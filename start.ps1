param(
  [int]$Port = 8787,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  Write-Host "[MockFast] Creating virtual environment..." -ForegroundColor Cyan
  python -m venv .venv
  Write-Host "[MockFast] Installing dependencies..." -ForegroundColor Cyan
  & ".venv\Scripts\python.exe" -m pip install -r requirements.txt
}

$arguments = @("run.py", "--port", "$Port")
if (-not $NoOpen) { $arguments += "--open" }
& ".venv\Scripts\python.exe" @arguments
