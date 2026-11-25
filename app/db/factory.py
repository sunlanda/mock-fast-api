"""Adapter factory and connection helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import BASE_DIR, DATA_DIR, SQLITE_SUFFIXES
from .base import BaseAdapter, DBError
from .mongo_adapter import MongoAdapter
from .mysql_adapter import MySQLAdapter
from .postgres_adapter import PostgresAdapter
from .sqlite_adapter import SQLiteAdapter

ADAPTERS: dict[str, type[BaseAdapter]] = {
    "sqlite": SQLiteAdapter,
    "postgres": PostgresAdapter,
    "mysql": MySQLAdapter,
    "mongodb": MongoAdapter,
}

KIND_LABELS = {
    "sqlite": "SQLite",
    "postgres": "PostgreSQL",
    "mysql": "MySQL",
    "mongodb": "MongoDB",
}


def normalize_config(kind: str, raw: dict[str, Any]) -> dict[str, Any]:
    if kind not in ADAPTERS:
        raise DBError(f"不支持的数据库类型：{kind}", kind="config_error")
    config = dict(raw or {})
    if kind == "sqlite":
        path_value = str(config.get("path") or "").strip()
        if not path_value:
            raise DBError("SQLite 数据库文件路径不能为空", kind="config_error")
        path = Path(path_value)
        if not path.is_absolute():
            normalized = path_value.replace("\\", "/")
            path = (BASE_DIR / path) if normalized.startswith("data/") else (DATA_DIR / path)
        path = path.resolve()
        if not path.is_relative_to(DATA_DIR):
            raise DBError(
                f"SQLite 文件必须放在 {DATA_DIR} 内（可避免网页读取任意本地文件）。",
                kind="policy_error",
            )
        if path.suffix.lower() not in SQLITE_SUFFIXES:
            raise DBError("SQLite 扩展名必须是 .db / .sqlite / .sqlite3")
        config["path"] = str(path)
        config.pop("host", None)
        config.pop("port", None)
        config.pop("user", None)
        config.pop("password", None)
        return config

    config.pop("path", None)
    if kind == "mongodb" and str(config.get("uri") or "").strip():
        config["uri"] = str(config["uri"]).strip()
        config.setdefault("database", config.get("database") or "test")
        if not config.get("database"):
            raise DBError("MongoDB 需要指定数据库名", kind="config_error")
        return config

    host = str(config.get("host") or "").strip() or "127.0.0.1"
    default_port = 5432 if kind == "postgres" else 3306 if kind == "mysql" else 27017
    try:
        port = int(config.get("port") or default_port)
    except (TypeError, ValueError) as exc:
        raise DBError("端口必须是数字", kind="config_error") from exc
    database = str(config.get("database") or "").strip()
    if kind == "mongodb":
        database = database or "test"
    if not database:
        raise DBError("数据库名不能为空", kind="config_error")
    config.update(
        {
            "host": host,
            "port": port,
            "database": database,
            "user": str(config.get("user") or ""),
            "ssl": bool(config.get("ssl")),
        }
    )
    if kind == "mongodb":
        config["auth_source"] = str(
            config.get("auth_source") or config.get("authSource") or "admin"
        )
    return config


def build_adapter(
    kind: str, config: dict[str, Any], *, read_only: bool = False
) -> BaseAdapter:
    adapter_class = ADAPTERS.get(kind)
    if adapter_class is None:
        raise DBError(f"不支持的数据库类型：{kind}", kind="config_error")
    merged = {**config, "_read_only": read_only}
    return adapter_class(merged)


def test_connection(
    kind: str, config: dict[str, Any], *, read_only: bool = False
) -> dict[str, Any]:
    adapter = build_adapter(kind, config, read_only=read_only)
    try:
        result = adapter.test()
        result["kind"] = kind
        result["label"] = KIND_LABELS.get(kind, kind)
        return result
    finally:
        adapter.close()
