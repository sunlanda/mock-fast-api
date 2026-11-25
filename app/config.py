"""Runtime configuration for MockFast.

Everything is intentionally local-first:
- the server binds to 127.0.0.1 by default;
- SQLite databases must live inside the project's data/ directory;
- remote database servers are blocked unless explicitly enabled.
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("MOCKFAST_DATA_DIR", BASE_DIR / "data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

META_DB_PATH = DATA_DIR / "app.db"
DEMO_DB_PATH = DATA_DIR / "demo.db"

HOST = os.getenv("MOCKFAST_HOST", "127.0.0.1")
PORT = int(os.getenv("MOCKFAST_PORT", "8787"))
VERSION = "1.0.0"

# None = follow the persisted setting, "1"/"0" = environment override.
ALLOW_REMOTE_ENV = os.getenv("MOCKFAST_ALLOW_REMOTE_DB")

MAX_PAGE_SIZE = 200
MAX_SQL_ROWS = 500
MAX_REQUEST_BYTES = 2 * 1024 * 1024
LOG_BODY_LIMIT = 8 * 1024
DEFAULT_LOG_RETENTION = 3000

LOCAL_HOSTS = {
    "",
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "host.docker.internal",
}

SQLITE_SUFFIXES = {".db", ".sqlite", ".sqlite3"}
