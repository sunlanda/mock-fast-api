"""PostgreSQL adapter (psycopg2)."""

from __future__ import annotations

import re
from typing import Any

from .base import (
    BaseAdapter,
    ColumnInfo,
    DBError,
    IndexInfo,
    TableInfo,
    safe_row,
)


class PostgresAdapter(BaseAdapter):
    kind = "postgres"
    default_port = 5432

    def connect(self) -> Any:
        try:
            import psycopg2
            import psycopg2.extras
        except ImportError as exc:
            raise DBError("缺少 psycopg2 驱动，请运行 pip install psycopg2-binary") from exc
        config = self.config
        sslmode = config.get("sslmode") or ("require" if config.get("ssl") else "prefer")
        try:
            conn = psycopg2.connect(
                host=config.get("host") or "127.0.0.1",
                port=int(config.get("port") or 5432),
                dbname=config.get("database") or "postgres",
                user=config.get("user") or "postgres",
                password=config.get("password") or "",
                connect_timeout=6,
                sslmode=sslmode,
                application_name="mock-fast-api",
                options="-c statement_timeout=20000",
            )
            conn.autocommit = False
            return conn
        except Exception as exc:
            raise DBError(
                f"PostgreSQL 连接失败：{self.clean_error(exc)}", kind="connection_error"
            ) from exc

    def server_version(self) -> str:
        try:
            row = self._fetch_one("SHOW server_version")
            return f"PostgreSQL {row['server_version'] if row else ''}".strip()
        except Exception:
            return "PostgreSQL"

    def default_schema(self) -> str:
        return self.config.get("schema") or "public"

    def list_schemas(self) -> list[str]:
        rows = self._fetch_all(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') "
            "AND schema_name NOT LIKE 'pg_%' ORDER BY schema_name"
        )
        return [row["schema_name"] for row in rows]

    def list_tables(self, schema: str | None = None) -> list[TableInfo]:
        schema = schema or self.default_schema()
        rows = self._fetch_all(
            """
            SELECT c.relname AS name, c.relkind AS relkind,
                   c.reltuples::bigint AS estimate,
                   pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
                   obj_description(c.oid) AS comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %s AND c.relkind IN ('r','p','v','m','f')
            ORDER BY c.relname
            """,
            [schema],
        )
        kind_map = {"r": "table", "p": "table", "v": "view", "m": "view", "f": "table"}
        tables: list[TableInfo] = []
        for row in rows:
            estimate = row["estimate"]
            tables.append(
                TableInfo(
                    name=row["name"],
                    schema=schema,
                    kind=kind_map.get(row["relkind"], "table"),
                    row_count=max(0, int(estimate or 0)) if estimate is not None else None,
                    size=row["size"],
                    comment=row["comment"] or "",
                )
            )
        return tables

    def get_table_detail(
        self, table: str, schema: str | None = None
    ) -> TableInfo:
        schema = schema or self.default_schema()
        rows = self._fetch_all(
            """
            SELECT column_name, data_type, udt_name, is_nullable, column_default,
                   ordinal_position, is_identity, is_generated
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
            """,
            [schema, table],
        )
        if not rows:
            raise DBError(f"表或视图不存在：{schema}.{table}", kind="not_found")
        primary_keys = {
            row["attname"]
            for row in self._fetch_all(
                """
                SELECT a.attname
                FROM pg_index i
                JOIN pg_class c ON c.oid = i.indrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
                WHERE n.nspname = %s AND c.relname = %s AND i.indisprimary
                """,
                [schema, table],
            )
        }
        comments: dict[str, str] = {}
        try:
            for row in self._fetch_all(
                """
                SELECT a.attname AS column_name,
                       col_description(a.attrelid, a.attnum) AS comment
                FROM pg_attribute a
                JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = %s AND c.relname = %s
                  AND a.attnum > 0 AND NOT a.attisdropped
                """,
                [schema, table],
            ):
                comments[row["column_name"]] = row["comment"] or ""
        except Exception:
            comments = {}
        columns: list[ColumnInfo] = []
        for row in rows:
            type_name = row["data_type"]
            if type_name == "USER-DEFINED":
                type_name = row["udt_name"]
            auto = row["is_identity"] == "YES" or (
                row["column_default"] or ""
            ).startswith("nextval(")
            columns.append(
                ColumnInfo(
                    name=row["column_name"],
                    type=type_name,
                    nullable=row["is_nullable"] == "YES",
                    default=row["column_default"],
                    primary_key=row["column_name"] in primary_keys,
                    auto_increment=auto,
                    comment=comments.get(row["column_name"], ""),
                    ordinal=int(row["ordinal_position"]),
                )
            )
        indexes: list[IndexInfo] = []
        for row in self._fetch_all(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = %s AND tablename = %s ORDER BY indexname",
            [schema, table],
        ):
            definition = row["indexdef"] or ""
            match = re.search(r"\((.*)\)", definition)
            index_columns = []
            if match:
                for piece in match.group(1).split(","):
                    cleaned = piece.strip().split(" ")[0].strip('"')
                    if cleaned:
                        index_columns.append(cleaned)
            indexes.append(
                IndexInfo(
                    name=row["indexname"],
                    columns=index_columns,
                    unique="UNIQUE INDEX" in definition,
                    primary=row["indexname"].endswith("_pkey"),
                )
            )
        foreign_keys = [
            {
                "constraint": row["constraint_name"],
                "column": row["column_name"],
                "references_table": row["references_table"],
                "references_column": row["references_column"],
            }
            for row in self._fetch_all(
                """
                SELECT tc.constraint_name, kcu.column_name,
                       ccu.table_name AS references_table,
                       ccu.column_name AS references_column
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON ccu.constraint_name = tc.constraint_name
                 AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_schema = %s AND tc.table_name = %s
                """,
                [schema, table],
            )
        ]
        row_count = int(
            self._fetch_scalar(
                f"SELECT COUNT(*) FROM {self.qualified(table, schema)}"
            )
            or 0
        )
        size = None
        try:
            size = self._fetch_scalar(
                "SELECT pg_size_pretty(pg_total_relation_size(%s::regclass))",
                [f'"{schema}"."{table}"'],
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
        return '"' + str(identifier).replace('"', '""') + '"'

    def placeholder(self) -> str:
        return "%s"

    def type_sql(self, logical_type: str) -> str:
        mapping = {
            "int": "INTEGER",
            "integer": "INTEGER",
            "string": "VARCHAR(255)",
            "text": "TEXT",
            "decimal": "NUMERIC(14,2)",
            "float": "DOUBLE PRECISION",
            "bool": "BOOLEAN",
            "boolean": "BOOLEAN",
            "datetime": "TIMESTAMPTZ",
            "timestamp": "TIMESTAMPTZ",
            "date": "DATE",
            "json": "JSONB",
        }
        return mapping.get(str(logical_type).lower(), "TEXT")

    def auto_pk_sql(self, column: dict[str, Any]) -> str:
        return f"{self.quote(column.get('name', 'id'))} SERIAL PRIMARY KEY"

    def like_sql(self, expression: str, placeholder: str) -> str:
        return f"CAST({expression} AS TEXT) ILIKE {placeholder}"

    def _cursor(self) -> Any:
        import psycopg2.extras

        return self.ensure().cursor(cursor_factory=psycopg2.extras.RealDictCursor)

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
            return safe_row(row)
        return {"ok": True}
