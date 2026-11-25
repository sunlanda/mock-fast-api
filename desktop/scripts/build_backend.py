"""Build the bundled MockFast backend executable with PyInstaller.

The resulting `mockfast-backend.exe` contains the FastAPI app, the web UI and
all database drivers. Electron only needs the Python process, not a Python
installation on the user's machine.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / "desktop"
WEB = ROOT / "web"
BACKEND_DIR = DESKTOP / "backend"
DIST_DIR = BACKEND_DIR / "dist"
BUILD_DIR = BACKEND_DIR / "build"
SPEC_DIR = BACKEND_DIR
ICON = DESKTOP / "build" / "icon.ico"


def main() -> int:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("[build-backend] PyInstaller is not installed.", file=sys.stderr)
        print("  python -m pip install pyinstaller", file=sys.stderr)
        return 1

    BACKEND_DIR.mkdir(parents=True, exist_ok=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "mockfast-backend",
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR),
        "--specpath",
        str(SPEC_DIR),
        "--add-data",
        f"{WEB}{os.pathsep}web",
        "--hidden-import",
        "app.main",
        "--hidden-import",
        "uvicorn.logging",
        "--hidden-import",
        "uvicorn.loops.auto",
        "--hidden-import",
        "uvicorn.protocols.http.auto",
        "--hidden-import",
        "uvicorn.protocols.websockets.auto",
        "--hidden-import",
        "uvicorn.lifespan.on",
        "--hidden-import",
        "psycopg2",
        "--hidden-import",
        "pymysql",
        "--hidden-import",
        "pymongo",
        "--hidden-import",
        "bson",
        "--hidden-import",
        "gridfs",
        "--collect-submodules",
        "app",
        "--collect-submodules",
        "uvicorn",
        "--collect-submodules",
        "pymongo",
        "--collect-submodules",
        "bson",
        "--exclude-module",
        "tkinter",
        "--log-level",
        "WARN",
    ]
    if sys.platform == "win32" and ICON.exists():
        command.extend(["--icon", str(ICON)])

    command.append(str(ROOT / "run.py"))
    print("[build-backend] Working directory:", ROOT)
    print("[build-backend] Python:", sys.executable)
    print("[build-backend] Building one-file backend...")
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode != 0:
        print(f"[build-backend] PyInstaller failed with exit code {result.returncode}", file=sys.stderr)
        return result.returncode

    executable = DIST_DIR / ("mockfast-backend.exe" if sys.platform == "win32" else "mockfast-backend")
    if not executable.exists():
        print(f"[build-backend] Output not found: {executable}", file=sys.stderr)
        return 1
    size_mb = executable.stat().st_size / 1024 / 1024
    print(f"[build-backend] OK: {executable} ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
