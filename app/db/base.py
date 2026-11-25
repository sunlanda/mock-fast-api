"""Database adapter contract and shared SQL helpers."""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, time as dt_time
from decimal import Decimal
from typing import Any
from uuid import UUID

from ..config import MAX_PAGE_SIZE


class DBError(Exception):
    """A user-facing database error."""

    def __init__(self, message: str, kind: str = "db_error", detail: Any = None):
        super().__init__(message)
        self.message = message
        self.kind = kind
        self.detail = detail


def json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date, dt_time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    try:
        from bson import ObjectId  # type: ignore

        if isinstance(value, ObjectId):
            return str(value)
    except Exception:
        pass
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return value


def safe_row(row: Any) -> dict[str, Any]:
    return {str(key): json_safe(value) for key, value in dict(row).items()}


def infer_value_type(value: Any) -> str:
    if value is None:
        return "unknown"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, (dict, list)):
        return "json"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "blob"
    if hasattr(value, "isoformat"):
        return "datetime"
    return "text"


@dataclass
class ColumnInfo:
    name: str
    type: str
    nullable: bool = True
    default: Any = None
    primary_key: bool = False
    auto_increment: bool = False
    comment: str = ""
    ordinal: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type,
            "nullable": self.nullable,
            "default": json_safe(self.default),
            "primary_key": self.primary_key,
            "auto_increment": self.auto_increment,
            "comment": self.comment,
            "ordinal": self.ordinal,
        }


@dataclass
class IndexInfo:
    name: str
    columns: list[str] = field(default_factory=list)
    unique: bool = False
    primary: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "columns": self.columns,
            "unique": self.unique,
            "primary": self.primary,
        }


@dataclass
class TableInfo:
    name: str
    schema: str | None = None
    kind: str = "table"
    row_count: int | None = None
    size: str | None = None
    comment: str = ""
    columns: list[ColumnInfo] = field(default_factory=list)
    indexes: list[IndexInfo] = field(default_factory=list)
    foreign_keys: list[dict[str, Any]] = field(default_factory=list)

    @property
    def primary_key(self) -> str | None:
        for column in self.columns:
            if column.primary_key:
                return column.name
        return self.columns[0].name if self.columns else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "schema": self.schema,
            "kind": self.kind,
            "row_count": self.row_count,
            "size": self.size,
            "comment": self.comment,
            "primary_key": self.primary_key,
            "columns": [column.to_dict() for column in self.columns],
            "indexes": [index.to_dict() for index in self.indexes],
            "foreign_keys": self.foreign_keys,
        }


SQL_WRITE_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|"
    r"REVOKE|VACUUM|ATTACH|DETACH)\b|PRAGMA\s+\w+\s*=",
    re.IGNORECASE,
)


class BaseAdapter:
    kind = "base"
    supports_sql = True
    supports_ddl = True
    default_port = 0

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.read_only = bool(config.get("_read_only"))
        self._conn: Any = None

    # -- lifecycle ---------------------------------------------------------
    def connect(self) -> Any:
        raise NotImplementedError

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def ensure(self) -> Any:
        if self._conn is None:
            self._conn = self.connect()
        return self._conn

    def __enter__(self) -> "BaseAdapter":
        self.ensure()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- metadata ----------------------------------------------------------
    def server_version(self) -> str:
        return "unknown"

    def test(self) -> dict[str, Any]:
        started = time.perf_counter()
        self.ensure()
        latency = round((time.perf_counter() - started) * 1000, 1)
        try:
            version = self.server_version()
        except Exception:
            version = "connected"
        return {"ok": True, "version": version, "latency_ms": latency}

    def list_schemas(self) -> list[str]:
        raise NotImplementedError

    def list_tables(self, schema: str | None = None) -> list[TableInfo]:
        raise NotImplementedError

    def get_table_detail(
        self, table: str, schema: str | None = None
    ) -> TableInfo:
        raise NotImplementedError

    def resolve_table(
        self, table: str, schema: str | None = None
    ) -> TableInfo:
        for info in self.list_tables(schema):
            if info.name == table:
                return self.get_table_detail(info.name, schema)
        lowered = table.lower()
        for info in self.list_tables(schema):
            if info.name.lower() == lowered:
                return self.get_table_detail(info.name, schema)
        raise DBError(f"表或集合不存在：{table}", kind="not_found")

    # -- SQL helpers -------------------------------------------------------
    def quote(self, identifier: str) -> str:
        raise NotImplementedError

    def placeholder(self) -> str:
        return "%s"

    def qualified(self, table: str, schema: str | None = None) -> str:
        if schema and self.kind != "sqlite":
            return f"{self.quote(schema)}.{self.quote(table)}"
        return self.quote(table)

    def type_sql(self, logical_type: str) -> str:
        raise NotImplementedError

    def auto_pk_sql(self, column: dict[str, Any]) -> str:
        raise NotImplementedError

    def adapt_value(self, column: ColumnInfo, value: Any) -> Any:
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return value

    def like_sql(self, expression: str, placeholder: str) -> str:
        return f"{expression} LIKE {placeholder}"

    def normalize_row(
        self, row: Any, columns: list[ColumnInfo]
    ) -> dict[str, Any]:
        data = safe_row(row)
        for column in columns:
            type_name = column.type.lower()
            if "bool" not in type_name and "tinyint(1)" not in type_name:
                continue
            value = data.get(column.name)
            if isinstance(value, int) and value in (0, 1):
                data[column.name] = bool(value)
            elif isinstance(value, str) and value.lower() in ("0", "1", "true", "false"):
                data[column.name] = value.lower() in ("1", "true")
        return data

    def _text_columns(self, columns: list[ColumnInfo]) -> list[str]:
        tokens = ("char", "text", "string", "json", "uuid", "enum")
        return [
            column.name
            for column in columns
            if any(token in column.type.lower() for token in tokens)
        ]

    def _coerce(self, column: ColumnInfo, value: Any) -> Any:
        if value is None:
            return None
        type_name = column.type.lower()
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.lower() == "null":
                return None
            if any(
                token in type_name
                for token in ("int", "serial", "number", "numeric", "decimal", "real", "double", "float")
            ) and stripped == "":
                return None
            try:
                if any(token in type_name for token in ("int", "serial", "bigint", "smallint")):
                    return int(stripped)
                if any(
                    token in type_name
                    for token in ("numeric", "decimal", "real", "double", "float")
                ):
                    return float(stripped)
                if "bool" in type_name:
                    return stripped.lower() in ("1", "true", "yes", "on", "是")
            except ValueError:
                return value
        return value

    def build_where(
        self,
        columns: list[ColumnInfo],
        filters: dict[str, Any],
        search: str | None,
    ) -> tuple[str, list[Any]]:
        by_name = {column.name: column for column in columns}
        clauses: list[str] = []
        params: list[Any] = []
        suffix_ops = {
            "__like": "LIKE",
            "__neq": "<>",
            "__gt": ">",
            "__gte": ">=",
            "__lt": "<",
            "__lte": "<=",
        }
        for raw_key, value in filters.items():
            key = raw_key
            operator = "="
            for suffix, suffix_op in suffix_ops.items():
                if raw_key.endswith(suffix):
                    key = raw_key[: -len(suffix)]
                    operator = suffix_op
                    break
            column = by_name.get(key)
            if column is None or value is None:
                continue
            value = self._coerce(column, value)
            if value is None:
                continue
            if operator == "LIKE":
                clauses.append(
                    self.like_sql(self.quote(column.name), self.placeholder())
                )
                params.append(f"%{value}%")
            else:
                clauses.append(
                    f"{self.quote(column.name)} {operator} {self.placeholder()}"
                )
                params.append(self.adapt_value(column, value))
        if search:
            text_columns = self._text_columns(columns)
            if text_columns:
                pieces = []
                for name in text_columns:
                    expression = f"CAST({self.quote(name)} AS TEXT)"
                    pieces.append(
                        self.like_sql(expression, self.placeholder())
                    )
                    params.append(f"%{search}%")
                clauses.append("(" + " OR ".join(pieces) + ")")
        if not clauses:
            return "", []
        return " WHERE " + " AND ".join(clauses), params

    # -- data --------------------------------------------------------------
    def list_rows(
        self,
        table: str,
        schema: str | None = None,
        *,
        page: int = 1,
        page_size: int = 20,
        sort: str | None = None,
        order: str = "asc",
        filters: dict[str, Any] | None = None,
        search: str | None = None,
    ) -> dict[str, Any]:
        info = self.resolve_table(table, schema)
        columns = info.columns
        names = {column.name for column in columns}
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 20), MAX_PAGE_SIZE))
        sort = sort if sort in names else (info.primary_key or (columns[0].name if columns else None))
        if not sort:
            raise DBError("表中没有可读取的字段")
        order_sql = "DESC" if str(order).lower() == "desc" else "ASC"
        where, params = self.build_where(columns, filters or {}, search)
        table_sql = self.qualified(info.name, info.schema)
        count_sql = f"SELECT COUNT(*) AS total FROM {table_sql}{where}"
        total = int(self._fetch_scalar(count_sql, params) or 0)
        offset = (page - 1) * page_size
        sql = (
            f"SELECT * FROM {table_sql}{where} "
            f"ORDER BY {self.quote(sort)} {order_sql} "
            f"LIMIT {page_size} OFFSET {offset}"
        )
        rows = [
            self.normalize_row(row, columns)
            for row in self._fetch_all(sql, params)
        ]
        return {
            "rows": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "columns": [column.to_dict() for column in columns],
            "primary_key": info.primary_key,
            "sort": sort,
            "order": order_sql.lower(),
        }

    def get_row(
        self, table: str, pk_value: Any, schema: str | None = None
    ) -> dict[str, Any] | None:
        info = self.resolve_table(table, schema)
        pk = info.primary_key
        if not pk:
            raise DBError("表没有主键，无法按 ID 查询")
        column = next(column for column in info.columns if column.name == pk)
        sql = (
            f"SELECT * FROM {self.qualified(info.name, info.schema)} "
            f"WHERE {self.quote(pk)} = {self.placeholder()} LIMIT 1"
        )
        row = self._fetch_one(sql, [self.adapt_value(column, pk_value)])
        return self.normalize_row(row, info.columns) if row else None

    def insert_row(
        self,
        table: str,
        data: dict[str, Any],
        schema: str | None = None,
        *,
        _internal: bool = False,
    ) -> dict[str, Any]:
        self.ensure_writable()
        info = self.resolve_table(table, schema)
        by_name = {column.name: column for column in info.columns}
        payload: dict[str, Any] = {}
        for key, value in (data or {}).items():
            column = by_name.get(key)
            if column is None:
                continue
            if value is None and column.auto_increment:
                continue
            if value == "" and column.auto_increment:
                continue
            payload[key] = self.adapt_value(column, value)
        if not payload:
            raise DBError("没有可写入的字段，请检查提交的数据")
        columns_sql = ", ".join(self.quote(key) for key in payload)
        placeholders = ", ".join(self.placeholder() for _ in payload)
        table_sql = self.qualified(info.name, info.schema)
        sql = f"INSERT INTO {table_sql} ({columns_sql}) VALUES ({placeholders})"
        return self._insert_returning(sql, list(payload.values()), info)

    def _insert_returning(
        self, sql: str, params: list[Any], info: TableInfo
    ) -> dict[str, Any]:
        cursor = self._cursor()
        try:
            cursor.execute(sql, params)
            last_id = getattr(cursor, "lastrowid", None)
            self._commit()
        except Exception as exc:
            self._rollback()
            raise DBError(f"写入失败：{self.clean_error(exc)}", kind="write_error") from exc
        if info.primary_key:
            row = self.get_row(info.name, last_id, info.schema)
            if row:
                return row
        return {"ok": True}

    def update_row(
        self,
        table: str,
        pk_value: Any,
        data: dict[str, Any],
        schema: str | None = None,
    ) -> dict[str, Any] | None:
        self.ensure_writable()
        info = self.resolve_table(table, schema)
        by_name = {column.name: column for column in info.columns}
        pk = info.primary_key
        if not pk:
            raise DBError("表没有主键，无法更新")
        payload: dict[str, Any] = {}
        for key, value in (data or {}).items():
            column = by_name.get(key)
            if column is None or key == pk:
                continue
            payload[key] = self.adapt_value(column, value)
        if not payload:
            raise DBError("没有可更新的字段")
        set_sql = ", ".join(
            f"{self.quote(key)} = {self.placeholder()}" for key in payload
        )
        pk_column = by_name[pk]
        sql = (
            f"UPDATE {self.qualified(info.name, info.schema)} SET {set_sql} "
            f"WHERE {self.quote(pk)} = {self.placeholder()}"
        )
        params = [*payload.values(), self.adapt_value(pk_column, pk_value)]
        cursor = self._cursor()
        try:
            cursor.execute(sql, params)
            self._commit()
        except Exception as exc:
            self._rollback()
            raise DBError(f"更新失败：{self.clean_error(exc)}", kind="write_error") from exc
        return self.get_row(info.name, pk_value, info.schema)

    def delete_row(
        self, table: str, pk_value: Any, schema: str | None = None
    ) -> int:
        self.ensure_writable()
        info = self.resolve_table(table, schema)
        pk = info.primary_key
        if not pk:
            raise DBError("表没有主键，无法删除")
        pk_column = next(column for column in info.columns if column.name == pk)
        sql = (
            f"DELETE FROM {self.qualified(info.name, info.schema)} "
            f"WHERE {self.quote(pk)} = {self.placeholder()}"
        )
        cursor = self._cursor()
        try:
            cursor.execute(sql, [self.adapt_value(pk_column, pk_value)])
            affected = cursor.rowcount
            self._commit()
        except Exception as exc:
            self._rollback()
            raise DBError(f"删除失败：{self.clean_error(exc)}", kind="write_error") from exc
        return int(affected or 0)

    def clear_table(self, table: str, schema: str | None = None) -> int:
        self.ensure_writable()
        info = self.resolve_table(table, schema)
        cursor = self._cursor()
        try:
            cursor.execute(f"DELETE FROM {self.qualified(info.name, info.schema)}")
            affected = cursor.rowcount
            self._commit()
        except Exception as exc:
            self._rollback()
            raise DBError(f"清空失败：{self.clean_error(exc)}", kind="write_error") from exc
        return int(affected or 0)

    def count_rows(self, table: str, schema: str | None = None) -> int:
        info = self.resolve_table(table, schema)
        return int(
            self._fetch_scalar(
                f"SELECT COUNT(*) FROM {self.qualified(info.name, info.schema)}"
            )
            or 0
        )

    def create_table(self, spec: dict[str, Any], schema: str | None = None) -> None:
        self.ensure_writable()
        name = spec.get("name") or spec.get("table")
        columns = spec.get("columns") or []
        if not name or not columns:
            raise DBError("建表信息不完整")
        pieces: list[str] = []
        for column in columns:
            column_name = column.get("name")
            if not column_name:
                continue
            if column.get("primary_key") and column.get("auto_increment"):
                pieces.append(self.auto_pk_sql(column))
                continue
            line = f"{self.quote(column_name)} {self.type_sql(column.get('type', 'string'))}"
            if column.get("primary_key"):
                line += " PRIMARY KEY"
            if not column.get("nullable", True):
                line += " NOT NULL"
            if column.get("default") is not None:
                line += f" DEFAULT {self._default_literal(column.get('default'))}"
            pieces.append(line)
        if not pieces:
            raise DBError("建表信息不完整")
        sql = (
            f"CREATE TABLE {self.qualified(name, schema)} ({', '.join(pieces)})"
        )
        cursor = self._cursor()
        try:
            cursor.execute(sql)
            self._commit()
        except Exception as exc:
            self._rollback()
            raise DBError(f"建表失败：{self.clean_error(exc)}", kind="ddl_error") from exc

    def _default_literal(self, value: Any) -> str:
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, (int, float)):
            return str(value)
        return "'" + str(value).replace("'", "''") + "'"

    # -- execution ---------------------------------------------------------
    def execute_statement(self, sql: str, max_rows: int = 200) -> dict[str, Any]:
        if self.read_only and SQL_WRITE_RE.search(sql):
            raise DBError("当前连接已开启只读模式，禁止执行写操作", kind="read_only")
        started = time.perf_counter()
        cursor = self._cursor()
        try:
            cursor.execute(sql)
            if cursor.description:
                fetched = cursor.fetchmany(max_rows + 1)
                truncated = len(fetched) > max_rows
                rows = [safe_row(row) for row in fetched[:max_rows]]
                sample = rows[0] if rows else {}
                columns = []
                for description in cursor.description:
                    column_name = description[0]
                    type_name = (
                        str(description[1]) if description[1] is not None else ""
                    )
                    if not type_name or type_name == "None":
                        type_name = infer_value_type(sample.get(column_name))
                    columns.append({"name": column_name, "type": type_name})
                self._commit()
                return {
                    "columns": columns,
                    "rows": rows,
                    "row_count": len(rows),
                    "affected": 0,
                    "truncated": truncated,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "kind": "select",
                }
            affected = cursor.rowcount
            self._commit()
            return {
                "columns": [],
                "rows": [],
                "row_count": 0,
                "affected": max(0, int(affected or 0)),
                "truncated": False,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "kind": "write",
            }
        except DBError:
            raise
        except Exception as exc:
            self._rollback()
            raise DBError(self.clean_error(exc), kind="sql_error") from exc

    # -- low level (implemented by drivers) --------------------------------
    def _cursor(self) -> Any:
        raise NotImplementedError

    def _fetch_all(self, sql: str, params: list[Any] | None = None) -> list[Any]:
        cursor = self._cursor()
        try:
            # psycopg2 treats "%" as a placeholder when a parameter list is
            # provided, so only pass params when there are actually params.
            if params:
                cursor.execute(sql, params)
            else:
                cursor.execute(sql)
            rows = cursor.fetchall()
            self._commit()
            return rows
        except DBError:
            raise
        except Exception as exc:
            self._rollback()
            raise DBError(self.clean_error(exc), kind="sql_error") from exc

    def _fetch_one(self, sql: str, params: list[Any] | None = None) -> Any:
        cursor = self._cursor()
        try:
            if params:
                cursor.execute(sql, params)
            else:
                cursor.execute(sql)
            row = cursor.fetchone()
            self._commit()
            return row
        except DBError:
            raise
        except Exception as exc:
            self._rollback()
            raise DBError(self.clean_error(exc), kind="sql_error") from exc

    def _fetch_scalar(self, sql: str, params: list[Any] | None = None) -> Any:
        row = self._fetch_one(sql, params)
        if row is None:
            return None
        if isinstance(row, dict):
            return next(iter(row.values()))
        return row[0]

    def _commit(self) -> None:
        if self._conn is not None and hasattr(self._conn, "commit"):
            self._conn.commit()

    def _rollback(self) -> None:
        if self._conn is not None and hasattr(self._conn, "rollback"):
            try:
                self._conn.rollback()
            except Exception:
                pass

    def ensure_writable(self) -> None:
        if self.read_only:
            raise DBError(
                "该连接为只读模式：可查询、可生成 Mock 读取接口，但不能写入或执行变更。",
                kind="read_only",
            )

    @staticmethod
    def clean_error(exc: Exception) -> str:
        try:
            message = str(exc).strip() or exc.__class__.__name__
        except UnicodeDecodeError:
            return "数据库返回了无法解码的错误信息，请检查连接参数。"
        if "codec can't decode" in message or "invalid continuation byte" in message:
            return "无法连接数据库：请检查主机、端口、网络与凭据（系统错误文本编码异常）。"
        message = re.sub(r"\s+", " ", message)
        return message[:600]
