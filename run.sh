#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ]; then
  echo "[MockFast] Creating virtual environment..."
  python3 -m venv .venv
  echo "[MockFast] Installing dependencies..."
  .venv/bin/python -m pip install -r requirements.txt
fi

exec .venv/bin/python run.py --open "$@"
