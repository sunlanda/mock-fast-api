@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [MockFast] Python 3 is required. Install it from https://www.python.org/downloads/ and try again.
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [MockFast] Creating virtual environment...
  python -m venv .venv
  if errorlevel 1 goto :fail
  echo [MockFast] Installing dependencies...
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto :fail
)

echo [MockFast] Starting on http://127.0.0.1:8787 ...
".venv\Scripts\python.exe" run.py --open %*
goto :eof

:fail
echo.
echo [MockFast] Setup failed. Try manually:
echo   python -m venv .venv
echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
pause
exit /b 1
