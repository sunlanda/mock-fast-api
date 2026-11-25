@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 not found.
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
)

echo Installing / updating MockFast dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
echo.
echo Done. Run run.bat or:
echo   .venv\Scripts\python.exe run.py --open
pause
