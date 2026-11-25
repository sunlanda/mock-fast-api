"""SQLite adapter — the zero-config default."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from ..config import DATA_DIR, SQLITE_SUFFIXES
from .base import (
    BaseAdapter,
    ColumnInfo,
    DBError,
    IndexInfo,
    TableInfo,
    safe_row,
)


class SQLiteAdapter(BaseAdapter):
    kind = "sqlite"

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        raw_path = str(config.get("path") or "").strip()
        if not raw_path:
            raise DBError("请提供 SQLite 数据库文件路径", kind="config_error")
        path = Path(raw_path)
        if not path.is_absolute():
            normalized = raw_path.replace("\\", "/")
            path = (
                (DATA_DIR.parent / path)
                if normalized.startswith("data/")
                else (DATA_DIR / path)
            )
        path = path.resolve()
        if not path.is_relative_to(DATA_DIR):
            raise DBError(
                f"出于安全考虑，SQLite 文件必须位于 {DATA_DIR} 目录内。",
                kind="policy_error",
            )
        if path.suffix.lower() not in SQLITE_SUFFIXES:
            raise DBError("SQLite 文件扩展名必须是 .db / .sqlite / .sqlite3")
        self.path = path
        self.config["path"] = str(path)

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            if self.read_only:
                if not self.path.exists():
                    raise DBError(f"数据库文件不存在：{self.path}", kind="not_found")
                conn = sqlite3.connect(
                    self.path.as_uri() + "?mode=ro",
                    uri=True,
                    timeout=8,
                    check_same_thread=False,
                )
            else:
                conn = sqlite3.connect(
                    str(self.path), timeout=8, check_same_thread=False
                )
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            return conn
        except DBError:
            raise
        except Exception as exc:
            raise DBError(f"无法打开 SQLite 数据库：{self.clean_error(exc)}") from exc

    def server_version(self) -> str:
        return f"SQLite {sqlite3.sqlite_version}"

    def list_schemas(self) -> list[str]:
        return ["main"]

    def list_tables(self, schema: str | None = None) -> list[TableInfo]:
        self.ensure()
        try:
            rows = self._conn.execute(
                "SELECT name, type FROM sqlite_master "
                "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' "
                "ORDER BY name"
            ).fetchall()
        except Exception as exc:
            raise DBError(f"读取表列表失败：{self.clean_error(exc)}") from exc
        tables: list[TableInfo] = []
        for row in rows:
            name = row["name"]
            count: int | None = 0
            try:
                count = int(
                    self._conn.execute(f"SELECT COUNT(*) FROM {self.quote(name)}")
                    .fetchone()[0]
                )
            except Exception:
                count = None
            tables.append(
                TableInfo(
                    name=name,
                    schema="main",
                    kind=row["type"],
                    row_count=count,
                )
            )
        return tables

    def get_table_detail(
        self, table: str, schema: str | None = None
    ) -> TableInfo:
        self.ensure()
        quoted = self.quote(table)
        try:
            info = self._conn.execute(f"PRAGMA table_info({quoted})").fetchall()
        except Exception as exc:
            raise DBError(f"读取表结构失败：{self.clean_error(exc)}") from exc
        if not info:
            raise DBError(f"表或视图不存在：{table}", kind="not_found")
        columns: list[ColumnInfo] = []
        for row in info:
            type_name = (row["type"] or "").upper()
            primary = bool(row["pk"])
            columns.append(
                ColumnInfo(
                    name=row["name"],
                    type=type_name or "TEXT",
                    nullable=not bool(row["notnull"]) and not primary,
                    default=row["dflt_value"],
                    primary_key=primary,
                    auto_increment=primary and "INT" in type_name,
                    ordinal=int(row["cid"]),
                )
            )
        indexes: list[IndexInfo] = []
        try:
            for index in self._conn.execute(f"PRAGMA index_list({quoted})").fetchall():
                index_name = index["name"]
                index_columns = [
                    item["name"]
                    for item in self._conn.execute(
                        f"PRAGMA index_info({self.quote(index_name)})"
                    ).fetchall()
                    if item["name"]
                ]
                indexes.append(
                    IndexInfo(
                        name=index_name,
                        columns=index_columns,
                        unique=bool(index["unique"]),
                        primary=index["origin"] == "pk",
                    )
                )
        except Exception:
            pass
        foreign_keys: list[dict[str, Any]] = []
        try:
            for fk in self._conn.execute(
                f"PRAGMA foreign_key_list({quoted})"
            ).fetchall():
                foreign_keys.append(
                    {
                        "id": fk["id"],
                        "column": fk["from"],
                        "references_table": fk["table"],
                        "references_column": fk["to"],
                        "on_update": fk["on_update"],
                        "on_delete": fk["on_delete"],
                    }
                )
        except Exception:
            pass
        try:
            count = int(
                self._conn.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0]
            )
        except Exception:
            count = None
        kind = "table"
        try:
            row = self._conn.execute(
                "SELECT type FROM sqlite_master WHERE name=?", (table,)
            ).fetchone()
            if row:
                kind = row["type"]
        except Exception:
            pass
        return TableInfo(
            name=table,
            schema="main",
            kind=kind,
            row_count=count,
            columns=columns,
            indexes=indexes,
            foreign_keys=foreign_keys,
        )

    def quote(self, identifier: str) -> str:
        return '"' + str(identifier).replace('"', '""') + '"'

    def placeholder(self) -> str:
        return "?"

    def type_sql(self, logical_type: str) -> str:
        mapping = {
            "int": "INTEGER",
            "integer": "INTEGER",
            "string": "TEXT",
            "text": "TEXT",
            "decimal": "REAL",
            "float": "REAL",
            "bool": "BOOLEAN",
            "boolean": "BOOLEAN",
            "datetime": "TEXT",
            "timestamp": "TEXT",
            "date": "TEXT",
            "json": "TEXT",
        }
        return mapping.get(str(logical_type).lower(), "TEXT")

    def auto_pk_sql(self, column: dict[str, Any]) -> str:
        return f"{self.quote(column.get('name', 'id'))} INTEGER PRIMARY KEY AUTOINCREMENT"

    def adapt_value(self, column: ColumnInfo, value: Any) -> Any:
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, (dict, list)):
            import json

            return json.dumps(value, ensure_ascii=False)
        return value

    def like_sql(self, expression: str, placeholder: str) -> str:
        return f"LOWER(CAST({expression} AS TEXT)) LIKE LOWER({placeholder})"

    def _cursor(self) -> Any:
        return self.ensure().cursor()

    def _insert_returning(
        self, sql: str, params: list[Any], info: TableInfo
    ) -> dict[str, Any]:
        cursor = self._cursor()
        try:
            cursor.execute(sql + " RETURNING *", params)
            row = cursor.fetchone()
            self._commit()
        except Exception as exc:
            self._rollback()
            raise DBError(f"写入失败：{self.clean_error(exc)}", kind="write_error") from exc
        if row:
            return self.normalize_row(row, info.columns)
        return {"ok": True}
