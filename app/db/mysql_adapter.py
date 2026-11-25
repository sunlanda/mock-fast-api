"""MySQL adapter (PyMySQL)."""

from __future__ import annotations

from typing import Any

from .base import (
    BaseAdapter,
    ColumnInfo,
    DBError,
    IndexInfo,
    TableInfo,
    safe_row,
)

SYSTEM_DATABASES = {"information_schema", "performance_schema", "mysql", "sys"}


def _human_size(size: int | None) -> str | None:
    if not size:
        return None
    value = float(size)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return None


class MySQLAdapter(BaseAdapter):
    kind = "mysql"
    default_port = 3306

    def connect(self) -> Any:
        try:
            import pymysql
            from pymysql.cursors import DictCursor
        except ImportError as exc:
            raise DBError("缺少 PyMySQL 驱动，请运行 pip install pymysql") from exc
        config = self.config
        kwargs: dict[str, Any] = {
            "host": config.get("host") or "127.0.0.1",
            "port": int(config.get("port") or 3306),
            "user": config.get("user") or "root",
            "password": config.get("password") or "",
            "database": config.get("database") or None,
            "charset": "utf8mb4",
            "connect_timeout": 6,
            "read_timeout": 20,
            "write_timeout": 20,
            "autocommit": False,
            "cursorclass": DictCursor,
        }
        if config.get("ssl"):
            kwargs["ssl"] = {}
            kwargs["ssl_verify_cert"] = False
            kwargs["ssl_verify_identity"] = False
        try:
            conn = pymysql.connect(**kwargs)
            return conn
        except Exception as exc:
            raise DBError(
                f"MySQL 连接失败：{self.clean_error(exc)}", kind="connection_error"
            ) from exc

    def server_version(self) -> str:
        try:
            row = self._fetch_one("SELECT VERSION() AS version")
            return f"MySQL {row['version'] if row else ''}".strip()
        except Exception:
            return "MySQL"

    def default_schema(self) -> str:
        database = self.config.get("database")
        if database:
            return str(database)
        schemas = self.list_schemas()
        if not schemas:
            raise DBError("当前账号没有可访问的数据库")
        return schemas[0]

    def list_schemas(self) -> list[str]:
        rows = self._fetch_all("SHOW DATABASES")
        names = [next(iter(row.values())) for row in rows]
        return [name for name in names if name not in SYSTEM_DATABASES]

    def list_tables(self, schema: str | None = None) -> list[TableInfo]:
        schema = schema or self.default_schema()
        rows = self._fetch_all(
            """
            SELECT table_name, table_type, table_rows, data_length, table_comment
            FROM information_schema.tables
            WHERE table_schema = %s
            ORDER BY table_name
            """,
            [schema],
        )
        tables: list[TableInfo] = []
        for row in rows:
            tables.append(
                TableInfo(
                    name=row["table_name"],
                    schema=schema,
                    kind="view" if row["table_type"] == "VIEW" else "table",
                    row_count=int(row["table_rows"] or 0) if row["table_rows"] is not None else None,
                    size=_human_size(row["data_length"]),
                    comment=row["table_comment"] or "",
                )
            )
        return tables

    def get_table_detail(
        self, table: str, schema: str | None = None
    ) -> TableInfo:
        schema = schema or self.default_schema()
        rows = self._fetch_all(
            """
            SELECT column_name, column_type, data_type, is_nullable, column_default,
                   column_key, extra, ordinal_position, column_comment
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
            """,
            [schema, table],
        )
        if not rows:
            raise DBError(f"表或视图不存在：{schema}.{table}", kind="not_found")
        columns: list[ColumnInfo] = []
        for row in rows:
            extra = (row["extra"] or "").lower()
            columns.append(
                ColumnInfo(
                    name=row["column_name"],
                    type=row["column_type"] or row["data_type"],
                    nullable=row["is_nullable"] == "YES",
                    default=row["column_default"],
                    primary_key=row["column_key"] == "PRI",
                    auto_increment="auto_increment" in extra,
                    comment=row["column_comment"] or "",
                    ordinal=int(row["ordinal_position"]),
                )
            )
        indexes: list[IndexInfo] = []
        try:
            index_rows = self._fetch_all(
                f"SHOW INDEX FROM {self.qualified(table, schema)}"
            )
            grouped: dict[str, dict[str, Any]] = {}
            for row in index_rows:
                name = row["Key_name"]
                group = grouped.setdefault(
                    name,
                    {
                        "columns": [],
                        "unique": not bool(row["Non_unique"]),
                        "primary": name == "PRIMARY",
                    },
                )
                group["columns"].append((int(row["Seq_in_index"]), row["Column_name"]))
            for name, group in grouped.items():
                indexes.append(
                    IndexInfo(
                        name=name,
                        columns=[
                            column for _, column in sorted(group["columns"])
                        ],
                        unique=group["unique"],
                        primary=group["primary"],
                    )
                )
        except Exception:
            pass
        foreign_keys = [
            {
                "constraint": row["constraint_name"],
                "column": row["column_name"],
                "references_table": row["referenced_table_name"],
                "references_column": row["referenced_column_name"],
            }
            for row in self._fetch_all(
                """
                SELECT constraint_name, column_name, referenced_table_name,
                       referenced_column_name
                FROM information_schema.key_column_usage
                WHERE table_schema = %s AND table_name = %s
                  AND referenced_table_name IS NOT NULL
                """,
                [schema, table],
            )
        ]
        row_count = int(
            self._fetch_scalar(
                f"SELECT COUNT(*) AS total FROM {self.qualified(table, schema)}"
            )
            or 0
        )
        size = None
        try:
            size = _human_size(
                self._fetch_scalar(
                    "SELECT data_length + index_length AS size FROM information_schema.tables "
                    "WHERE table_schema=%s AND table_name=%s",
                    [schema, table],
                )
            )
        except Exception:
            pass
        return TableInfo(
            name=table,
            schema=schema,
            row_count=row_count,
            size=size,
            columns=columns,
            indexes=indexes,
            foreign_keys=foreign_keys,
        )

    def quote(self, identifier: str) -> str:
        return "`" + str(identifier).replace("`", "``") + "`"

    def placeholder(self) -> str:
        return "%s"

    def type_sql(self, logical_type: str) -> str:
        mapping = {
            "int": "INT",
            "integer": "INT",
            "string": "VARCHAR(255)",
            "text": "TEXT",
            "decimal": "DECIMAL(14,2)",
            "float": "DOUBLE",
            "bool": "TINYINT(1)",
            "boolean": "TINYINT(1)",
            "datetime": "DATETIME",
            "timestamp": "DATETIME",
            "date": "DATE",
            "json": "JSON",
        }
        return mapping.get(str(logical_type).lower(), "TEXT")

    def auto_pk_sql(self, column: dict[str, Any]) -> str:
        return f"{self.quote(column.get('name', 'id'))} INT AUTO_INCREMENT PRIMARY KEY"

    def like_sql(self, expression: str, placeholder: str) -> str:
        return f"CAST({expression} AS CHAR) LIKE {placeholder}"

    def _cursor(self) -> Any:
        return self.ensure().cursor()

    def _insert_returning(
        self, sql: str, params: list[Any], info: TableInfo
    ) -> dict[str, Any]:
        cursor = self._cursor()
        try:
            cursor.execute(sql, params)
            last_id = cursor.lastrowid
            self._commit()
        except Exception as exc:
            self._rollback()
            raise DBError(f"写入失败：{self.clean_error(exc)}", kind="write_error") from exc
        if info.primary_key and last_id:
            row = self.get_row(info.name, last_id, info.schema)
            if row:
                return row
        return {"ok": True}
