"""SQLite metadata store: connections, mock projects, request logs, settings."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import (
    ALLOW_REMOTE_ENV,
    DEFAULT_LOG_RETENTION,
    LOCAL_HOSTS,
    META_DB_PATH,
)

_init_lock = threading.Lock()
_initialized = False
_log_insert_counter = 0
_log_counter_lock = threading.Lock()

DEFAULT_SETTINGS: dict[str, str] = {
    "allow_remote_db": "0",
    "log_retention": str(DEFAULT_LOG_RETENTION),
    "bootstrapped": "0",
    "theme": "dark",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(META_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    global _initialized
    with _init_lock:
        if _initialized:
            return
        with db() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS connections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    config TEXT NOT NULL,
                    read_only INTEGER NOT NULL DEFAULT 0,
                    is_remote INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    slug TEXT NOT NULL UNIQUE,
                    connection_id TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    schema_name TEXT,
                    template_id TEXT,
                    pk_column TEXT NOT NULL DEFAULT 'id',
                    response_format TEXT NOT NULL DEFAULT 'result.data.pagination',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'mock',
                    method TEXT NOT NULL,
                    path TEXT NOT NULL,
                    status INTEGER NOT NULL,
                    duration_ms REAL NOT NULL,
                    req_headers TEXT NOT NULL DEFAULT '{}',
                    req_body TEXT NOT NULL DEFAULT '',
                    query TEXT NOT NULL DEFAULT '',
                    resp_headers TEXT NOT NULL DEFAULT '{}',
                    resp_preview TEXT NOT NULL DEFAULT '',
                    size INTEGER NOT NULL DEFAULT 0,
                    project_slug TEXT,
                    client TEXT,
                    error TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);
                CREATE INDEX IF NOT EXISTS idx_logs_project ON logs(project_slug);
                CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status);

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
            )
            for key, value in DEFAULT_SETTINGS.items():
                conn.execute(
                    "INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)",
                    (key, value),
                )
            project_columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(projects)")
            }
            if "template_id" not in project_columns:
                conn.execute("ALTER TABLE projects ADD COLUMN template_id TEXT")
        _initialized = True


# --------------------------------------------------------------------------- #
# settings
# --------------------------------------------------------------------------- #


def _raw_settings() -> dict[str, str]:
    with db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    merged = dict(DEFAULT_SETTINGS)
    merged.update({row["key"]: row["value"] for row in rows})
    return merged


def get_settings() -> dict[str, Any]:
    raw = _raw_settings()
    env_override = ALLOW_REMOTE_ENV is not None
    allow_remote = (
        ALLOW_REMOTE_ENV in ("1", "true", "yes", "on")
        if env_override
        else raw.get("allow_remote_db") == "1"
    )
    try:
        retention = int(raw.get("log_retention", DEFAULT_LOG_RETENTION))
    except (TypeError, ValueError):
        retention = DEFAULT_LOG_RETENTION
    return {
        "allow_remote_db": allow_remote,
        "allow_remote_source": "env" if env_override else "setting",
        "log_retention": max(200, min(retention, 20000)),
        "theme": raw.get("theme", "dark"),
        "data_dir": str(META_DB_PATH.parent),
    }


def allow_remote_db() -> bool:
    return bool(get_settings()["allow_remote_db"])


def set_settings(patch: dict[str, Any]) -> dict[str, Any]:
    allowed = {"allow_remote_db", "log_retention", "theme"}
    with db() as conn:
        for key, value in patch.items():
            if key not in allowed or value is None:
                continue
            if key == "allow_remote_db":
                if ALLOW_REMOTE_ENV is not None:
                    continue
                value = "1" if value else "0"
            elif key == "log_retention":
                value = str(max(200, min(int(value), 20000)))
            else:
                value = str(value)
            conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
    return get_settings()


# --------------------------------------------------------------------------- #
# connections
# --------------------------------------------------------------------------- #


def _target_label(kind: str, config: dict[str, Any]) -> str:
    if kind == "sqlite":
        return config.get("path", "")
    if kind == "mongodb":
        if config.get("uri"):
            # Never echo credentials embedded in a Mongo URI to the browser.
            return re.sub(r"//[^/@]+@", "//***@", str(config["uri"]))
        host = config.get("host") or "localhost"
        port = config.get("port") or 27017
        database = config.get("database") or ""
        return f"{host}:{port}/{database}"
    host = config.get("host") or "localhost"
    port = config.get("port") or (5432 if kind == "postgres" else 3306)
    database = config.get("database") or ""
    return f"{host}:{port}/{database}"


def connection_is_remote(kind: str, config: dict[str, Any]) -> bool:
    if kind == "sqlite":
        return False
    if kind == "mongodb" and config.get("uri"):
        from urllib.parse import urlsplit

        try:
            host = (urlsplit(str(config["uri"])).hostname or "").lower()
        except ValueError:
            host = ""
        return host not in LOCAL_HOSTS
    host = str(config.get("host") or "").strip().lower()
    return host not in LOCAL_HOSTS


def _public_connection(row: sqlite3.Row) -> dict[str, Any]:
    raw_config = json.loads(row["config"] or "{}")
    has_password = bool(raw_config.get("password"))
    config = {
        key: value
        for key, value in raw_config.items()
        if key not in ("password", "uri")
    }
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "config": config,
        "has_password": has_password,
        "has_uri": bool(raw_config.get("uri")),
        "read_only": bool(row["read_only"]),
        "is_remote": bool(row["is_remote"]),
        "target": _target_label(row["kind"], raw_config),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_connections() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM connections ORDER BY created_at ASC"
        ).fetchall()
    return [_public_connection(row) for row in rows]


def get_connection(connection_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM connections WHERE id=?", (connection_id,)
        ).fetchone()
    return dict(row) if row else None


def get_connection_public(connection_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM connections WHERE id=?", (connection_id,)
        ).fetchone()
    return _public_connection(row) if row else None


def create_connection(
    name: str,
    kind: str,
    config: dict[str, Any],
    read_only: bool,
    is_remote: bool,
) -> dict[str, Any]:
    connection_id = uuid.uuid4().hex[:12]
    now = utc_now()
    with db() as conn:
        conn.execute(
            "INSERT INTO connections"
            "(id, name, kind, config, read_only, is_remote, created_at, updated_at)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (
                connection_id,
                name,
                kind,
                json.dumps(config, ensure_ascii=False),
                1 if read_only else 0,
                1 if is_remote else 0,
                now,
                now,
            ),
        )
    return get_connection_public(connection_id)  # type: ignore[return-value]


def update_connection(
    connection_id: str,
    *,
    name: str | None = None,
    config: dict[str, Any] | None = None,
    read_only: bool | None = None,
    is_remote: bool | None = None,
) -> dict[str, Any] | None:
    row = get_connection(connection_id)
    if not row:
        return None
    next_config = json.loads(row["config"] or "{}")
    if config is not None:
        # Blank password means "keep the stored secret".
        if not config.get("password") and next_config.get("password"):
            config = {**config, "password": next_config["password"]}
        next_config = config
    with db() as conn:
        conn.execute(
            "UPDATE connections SET name=?, config=?, read_only=?, is_remote=?, "
            "updated_at=? WHERE id=?",
            (
                name or row["name"],
                json.dumps(next_config, ensure_ascii=False),
                1 if (read_only if read_only is not None else row["read_only"]) else 0,
                1
                if (is_remote if is_remote is not None else row["is_remote"])
                else 0,
                utc_now(),
                connection_id,
            ),
        )
    return get_connection_public(connection_id)


def delete_connection(connection_id: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM connections WHERE id=?", (connection_id,))


# --------------------------------------------------------------------------- #
# projects
# --------------------------------------------------------------------------- #


def _project_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "slug": row["slug"],
        "connection_id": row["connection_id"],
        "table_name": row["table_name"],
        "schema_name": row["schema_name"],
        "template_id": row["template_id"],
        "pk_column": row["pk_column"],
        "response_format": row["response_format"],
        "created_at": row["created_at"],
        "base_path": f"/mock/{row['slug']}",
    }


def list_projects() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM projects ORDER BY created_at DESC"
        ).fetchall()
    return [_project_row(row) for row in rows]


def get_project(project_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM projects WHERE id=?", (project_id,)
        ).fetchone()
    return _project_row(row) if row else None


def get_project_by_slug(slug: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM projects WHERE slug=?", (slug,)
        ).fetchone()
    return _project_row(row) if row else None


def slug_exists(slug: str) -> bool:
    with db() as conn:
        row = conn.execute(
            "SELECT 1 FROM projects WHERE slug=?", (slug,)
        ).fetchone()
    return row is not None


def create_project(
    *,
    name: str,
    slug: str,
    connection_id: str,
    table_name: str,
    schema_name: str | None,
    pk_column: str,
    response_format: str,
    template_id: str | None = None,
) -> dict[str, Any]:
    project_id = uuid.uuid4().hex[:12]
    with db() as conn:
        conn.execute(
            "INSERT INTO projects"
            "(id, name, slug, connection_id, table_name, schema_name, template_id,"
            " pk_column, response_format, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                project_id,
                name,
                slug,
                connection_id,
                table_name,
                schema_name,
                template_id,
                pk_column,
                response_format,
                utc_now(),
            ),
        )
    return get_project(project_id)  # type: ignore[return-value]


def update_project(
    project_id: str,
    *,
    name: str | None = None,
    response_format: str | None = None,
) -> dict[str, Any] | None:
    row = get_project(project_id)
    if not row:
        return None
    with db() as conn:
        conn.execute(
            "UPDATE projects SET name=?, response_format=? WHERE id=?",
            (
                name or row["name"],
                response_format or row["response_format"],
                project_id,
            ),
        )
    return get_project(project_id)


def delete_project(project_id: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))


# --------------------------------------------------------------------------- #
# logs
# --------------------------------------------------------------------------- #


def insert_log(entry: dict[str, Any]) -> None:
    global _log_insert_counter
    settings = get_settings()
    retention = settings["log_retention"]
    with db() as conn:
        conn.execute(
            "INSERT INTO logs"
            "(ts, kind, method, path, status, duration_ms, req_headers, req_body,"
            " query, resp_headers, resp_preview, size, project_slug, client, error)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                entry.get("ts") or utc_now(),
                entry.get("kind", "mock"),
                entry.get("method", "GET"),
                entry.get("path", "/"),
                int(entry.get("status", 0)),
                float(entry.get("duration_ms", 0)),
                json.dumps(entry.get("req_headers", {}), ensure_ascii=False),
                entry.get("req_body", ""),
                entry.get("query", ""),
                json.dumps(entry.get("resp_headers", {}), ensure_ascii=False),
                entry.get("resp_preview", ""),
                int(entry.get("size", 0)),
                entry.get("project_slug"),
                entry.get("client"),
                entry.get("error"),
            ),
        )
        with _log_counter_lock:
            _log_insert_counter += 1
            should_prune = _log_insert_counter % 25 == 0
        if should_prune:
            conn.execute(
                "DELETE FROM logs WHERE id <= (SELECT MAX(id) FROM logs) - ?",
                (retention,),
            )


def _log_row(row: sqlite3.Row, preview: bool = True) -> dict[str, Any]:
    def loads(value: str) -> Any:
        try:
            return json.loads(value or "{}")
        except (TypeError, ValueError):
            return {}

    resp_preview = row["resp_preview"] or ""
    if preview and len(resp_preview) > 900:
        resp_preview = resp_preview[:900] + "…"
    return {
        "id": row["id"],
        "ts": row["ts"],
        "kind": row["kind"],
        "method": row["method"],
        "path": row["path"],
        "status": row["status"],
        "duration_ms": round(row["duration_ms"], 2),
        "req_headers": loads(row["req_headers"]),
        "req_body": row["req_body"] or "",
        "query": row["query"] or "",
        "resp_headers": loads(row["resp_headers"]),
        "resp_preview": resp_preview,
        "size": row["size"],
        "project_slug": row["project_slug"],
        "client": row["client"],
        "error": row["error"],
    }


def list_logs(
    *,
    limit: int = 50,
    offset: int = 0,
    project: str | None = None,
    status: str | None = None,
    q: str | None = None,
    kind: str | None = None,
) -> dict[str, Any]:
    clauses: list[str] = []
    params: list[Any] = []
    if project:
        clauses.append("project_slug = ?")
        params.append(project)
    if kind:
        clauses.append("kind = ?")
        params.append(kind)
    if status:
        if status == "2xx":
            clauses.append("status >= 200 AND status < 300")
        elif status == "3xx":
            clauses.append("status >= 300 AND status < 400")
        elif status == "4xx":
            clauses.append("status >= 400 AND status < 500")
        elif status == "5xx":
            clauses.append("status >= 500")
        elif status == "error":
            clauses.append("status >= 400")
    if q:
        clauses.append("(path LIKE ? OR method LIKE ? OR req_body LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS c FROM logs {where}", params
        ).fetchone()["c"]
        rows = conn.execute(
            f"SELECT * FROM logs {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return {
        "items": [_log_row(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_log(log_id: int) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM logs WHERE id=?", (log_id,)).fetchone()
    if not row:
        return None
    item = _log_row(row, preview=False)
    item["req_body"] = item["req_body"]
    return item


def log_stats() -> dict[str, Any]:
    with db() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM logs").fetchone()["c"]
        today = conn.execute(
            "SELECT COUNT(*) AS c FROM logs WHERE ts >= ?",
            (datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00"),),
        ).fetchone()["c"]
        rows = conn.execute(
            "SELECT status, duration_ms FROM logs ORDER BY id DESC LIMIT 1000"
        ).fetchall()
        series = conn.execute(
            "SELECT duration_ms, status, ts FROM logs ORDER BY id DESC LIMIT 40"
        ).fetchall()
        top_rows = conn.execute(
            "SELECT path, COUNT(*) AS c, AVG(duration_ms) AS avg_ms FROM logs "
            "GROUP BY path ORDER BY c DESC LIMIT 5"
        ).fetchall()
    durations = sorted(float(row["duration_ms"]) for row in rows)
    avg_ms = round(sum(durations) / len(durations), 1) if durations else 0
    if durations:
        index = min(len(durations) - 1, int(len(durations) * 0.95))
        p95 = round(durations[index], 1)
    else:
        p95 = 0
    errors = sum(1 for row in rows if row["status"] >= 400)
    return {
        "total": total,
        "today": today,
        "avg_ms": avg_ms,
        "p95_ms": p95,
        "error_rate": round(errors / len(rows) * 100, 1) if rows else 0,
        "series": [
            {
                "duration_ms": round(row["duration_ms"], 1),
                "status": row["status"],
                "ts": row["ts"],
            }
            for row in reversed(series)
        ],
        "top_paths": [
            {
                "path": row["path"],
                "count": row["c"],
                "avg_ms": round(row["avg_ms"] or 0, 1),
            }
            for row in top_rows
        ],
    }


def clear_logs() -> None:
    with db() as conn:
        conn.execute("DELETE FROM logs")


def set_bootstrapped(value: bool = True) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('bootstrapped', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ("1" if value else "0",),
        )


def is_bootstrapped() -> bool:
    raw = _raw_settings()
    return raw.get("bootstrapped") == "1"


def count_projects() -> int:
    with db() as conn:
        return int(conn.execute("SELECT COUNT(*) AS c FROM projects").fetchone()["c"])
