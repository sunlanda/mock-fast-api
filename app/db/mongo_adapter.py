"""MongoDB adapter (PyMongo)."""

from __future__ import annotations

import re
import time
from datetime import date, datetime
from typing import Any

from .base import (
    BaseAdapter,
    ColumnInfo,
    DBError,
    IndexInfo,
    TableInfo,
    json_safe,
    safe_row,
)

BLOCKED_OPERATORS = {
    "$where",
    "$function",
    "$accumulator",
}
BLOCKED_PIPELINE_STAGES = {"$out", "$merge"}
BLOCKED_OPERATIONS = {
    "drop",
    "dropDatabase",
    "dropCollection",
    "rename",
    "createUser",
    "dropUser",
    "eval",
    "mapReduce",
}


def _type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "double"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (datetime, date)):
        return "date"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, (list, tuple)):
        return "array"
    try:
        from bson import ObjectId

        if isinstance(value, ObjectId):
            return "objectId"
    except Exception:
        pass
    return type(value).__name__


def _parse_maybe(value: Any, key: str | None = None) -> Any:
    if not isinstance(value, str):
        return value
    lowered = value.strip()
    if lowered.lower() in ("true", "false"):
        return lowered.lower() == "true"
    if lowered.lower() == "null":
        return None
    if re.fullmatch(r"-?\d+", lowered):
        return int(lowered)
    if re.fullmatch(r"-?\d+\.\d+", lowered):
        return float(lowered)
    if key == "_id":
        try:
            from bson import ObjectId

            if ObjectId.is_valid(lowered):
                return ObjectId(lowered)
        except Exception:
            pass
    return value


def _parse_id(value: Any) -> Any:
    if isinstance(value, str):
        try:
            from bson import ObjectId

            if ObjectId.is_valid(value):
                return ObjectId(value)
        except Exception:
            pass
    return value


def _contains_blocked(value: Any, blocked: set[str]) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in blocked:
                return True
            if _contains_blocked(item, blocked):
                return True
    elif isinstance(value, list):
        return any(_contains_blocked(item, blocked) for item in value)
    return False


class MongoAdapter(BaseAdapter):
    kind = "mongodb"
    supports_sql = False
    supports_ddl = False
    default_port = 27017

    def connect(self) -> Any:
        try:
            from pymongo import MongoClient
        except ImportError as exc:
            raise DBError("缺少 pymongo 驱动，请运行 pip install pymongo") from exc
        config = self.config
        try:
            if config.get("uri"):
                client = MongoClient(
                    config["uri"],
                    serverSelectionTimeoutMS=6000,
                    connectTimeoutMS=6000,
                    socketTimeoutMS=30000,
                )
            else:
                client = MongoClient(
                    host=config.get("host") or "127.0.0.1",
                    port=int(config.get("port") or 27017),
                    username=config.get("user") or None,
                    password=config.get("password") or None,
                    authSource=config.get("auth_source") or config.get("database") or "admin",
                    serverSelectionTimeoutMS=6000,
                    connectTimeoutMS=6000,
                    socketTimeoutMS=30000,
                )
            client.admin.command("ping")
            return client
        except Exception as exc:
            raise DBError(
                f"MongoDB 连接失败：{self.clean_error(exc)}", kind="connection_error"
            ) from exc

    def server_version(self) -> str:
        try:
            info = self.ensure().server_info()
            return f"MongoDB {info.get('version', '')}".strip()
        except Exception:
            return "MongoDB"

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def _database(self, schema: str | None = None) -> Any:
        name = schema or self.config.get("database") or "test"
        return self.ensure()[name]

    def list_schemas(self) -> list[str]:
        try:
            names = self.ensure().list_database_names()
        except Exception as exc:
            raise DBError(f"读取数据库列表失败：{self.clean_error(exc)}") from exc
        names = [name for name in names if name not in ("admin", "local", "config")]
        configured = self.config.get("database")
        if configured and configured not in names:
            names.append(configured)
        return sorted(names)

    def list_tables(self, schema: str | None = None) -> list[TableInfo]:
        database = self._database(schema)
        try:
            specs = list(database.list_collections())
        except Exception as exc:
            raise DBError(f"读取集合列表失败：{self.clean_error(exc)}") from exc
        tables: list[TableInfo] = []
        for spec in specs:
            name = spec.get("name", "")
            if name.startswith("system."):
                continue
            try:
                count = database[name].estimated_document_count()
            except Exception:
                count = None
            tables.append(
                TableInfo(
                    name=name,
                    schema=database.name,
                    kind="view" if spec.get("type") == "view" else "collection",
                    row_count=count,
                )
            )
        return sorted(tables, key=lambda item: item.name)

    def get_table_detail(
        self, table: str, schema: str | None = None
    ) -> TableInfo:
        database = self._database(schema)
        try:
            names = database.list_collection_names()
        except Exception as exc:
            raise DBError(f"读取集合失败：{self.clean_error(exc)}") from exc
        if table not in names:
            raise DBError(f"集合不存在：{table}", kind="not_found")
        collection = database[table]
        sample = list(collection.find({}).limit(60))
        fields: dict[str, dict[str, Any]] = {}

        def walk(document: dict[str, Any], prefix: str = "", depth: int = 0) -> None:
            for key, value in document.items():
                path = f"{prefix}{key}"
                entry = fields.setdefault(path, {"types": set(), "present": 0})
                entry["present"] += 1
                entry["types"].add(_type_name(value))
                if isinstance(value, dict) and depth < 2:
                    walk(value, f"{path}.")

        for document in sample:
            walk(document)
        columns: list[ColumnInfo] = []
        if "_id" not in fields:
            fields = {"_id": {"types": {"objectId"}, "present": len(sample)}, **fields}
        for path, entry in fields.items():
            types = " | ".join(sorted(entry["types"]))
            columns.append(
                ColumnInfo(
                    name=path,
                    type=types,
                    nullable=entry["present"] < len(sample) or "null" in entry["types"],
                    primary_key=path == "_id",
                    auto_increment=False,
                    comment=f"采样 {len(sample)} 条文档",
                    ordinal=len(columns),
                )
            )
        indexes: list[IndexInfo] = []
        try:
            for index in collection.list_indexes():
                keys = index.get("key", {})
                indexes.append(
                    IndexInfo(
                        name=index.get("name", ""),
                        columns=[str(key) for key in keys.keys()],
                        unique=bool(index.get("unique")),
                        primary=index.get("name") == "_id_",
                    )
                )
        except Exception:
            pass
        try:
            row_count = int(collection.count_documents({}, maxTimeMS=5000))
        except Exception:
            row_count = collection.estimated_document_count()
        size = None
        try:
            stats = database.command("collstats", table)
            size_bytes = stats.get("size")
            if size_bytes:
                size = f"{size_bytes / 1024 / 1024:.1f} MB"
        except Exception:
            pass
        return TableInfo(
            name=table,
            schema=database.name,
            kind="collection",
            row_count=row_count,
            size=size,
            columns=columns,
            indexes=indexes,
            foreign_keys=[],
        )

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
        database = self._database(schema)
        info = self.get_table_detail(table, schema)
        names = {column.name for column in info.columns}
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 20), 200))
        query: dict[str, Any] = {}
        for raw_key, value in (filters or {}).items():
            key = raw_key
            operator = None
            for suffix, op in (
                ("__neq", "$ne"),
                ("__gt", "$gt"),
                ("__gte", "$gte"),
                ("__lt", "$lt"),
                ("__lte", "$lte"),
            ):
                if raw_key.endswith(suffix):
                    key = raw_key[: -len(suffix)]
                    operator = op
                    break
            if raw_key.endswith("__like"):
                key = raw_key[: -len("__like")]
                query[key] = {"$regex": re.escape(str(value)), "$options": "i"}
                continue
            if key not in names:
                continue
            parsed = _parse_maybe(value, key)
            if operator:
                query.setdefault(key, {})[operator] = parsed
            else:
                query[key] = parsed
        if search:
            string_fields = [
                column.name
                for column in info.columns
                if "string" in column.type and not column.name.startswith("_id")
            ]
            if string_fields:
                query["$or"] = [
                    {field: {"$regex": re.escape(search), "$options": "i"}}
                    for field in string_fields
                ]
        collection = database[table]
        total = (
            int(collection.estimated_document_count())
            if not query
            else int(collection.count_documents(query, maxTimeMS=10000))
        )
        sort_field = sort if sort in names else "_id"
        direction = -1 if str(order).lower() == "desc" else 1
        cursor = (
            collection.find(query)
            .sort(sort_field, direction)
            .skip((page - 1) * page_size)
            .limit(page_size)
            .max_time_ms(20000)
        )
        rows = [safe_row(document) for document in cursor]
        return {
            "rows": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "columns": [column.to_dict() for column in info.columns],
            "primary_key": "_id",
            "sort": sort_field,
            "order": "desc" if direction == -1 else "asc",
        }

    def get_row(
        self, table: str, pk_value: Any, schema: str | None = None
    ) -> dict[str, Any] | None:
        database = self._database(schema)
        if table not in database.list_collection_names():
            raise DBError(f"集合不存在：{table}", kind="not_found")
        document = database[table].find_one({"_id": _parse_id(pk_value)})
        return safe_row(document) if document else None

    def insert_row(
        self,
        table: str,
        data: dict[str, Any],
        schema: str | None = None,
        *,
        _internal: bool = False,
    ) -> dict[str, Any]:
        self.ensure_writable()
        database = self._database(schema)
        document = dict(data or {})
        if document.get("_id") in ("", None):
            document.pop("_id", None)
        try:
            result = database[table].insert_one(document)
            inserted = database[table].find_one({"_id": result.inserted_id})
        except Exception as exc:
            raise DBError(f"写入失败：{self.clean_error(exc)}", kind="write_error") from exc
        return safe_row(inserted) if inserted else {"ok": True}

    def update_row(
        self,
        table: str,
        pk_value: Any,
        data: dict[str, Any],
        schema: str | None = None,
    ) -> dict[str, Any] | None:
        self.ensure_writable()
        database = self._database(schema)
        payload = {key: value for key, value in (data or {}).items() if key != "_id"}
        if not payload:
            raise DBError("没有可更新的字段")
        try:
            document = database[table].find_one_and_update(
                {"_id": _parse_id(pk_value)},
                {"$set": payload},
                return_document=True,
            )
        except Exception as exc:
            raise DBError(f"更新失败：{self.clean_error(exc)}", kind="write_error") from exc
        return safe_row(document) if document else None

    def delete_row(
        self, table: str, pk_value: Any, schema: str | None = None
    ) -> int:
        self.ensure_writable()
        database = self._database(schema)
        try:
            result = database[table].delete_one({"_id": _parse_id(pk_value)})
        except Exception as exc:
            raise DBError(f"删除失败：{self.clean_error(exc)}", kind="write_error") from exc
        return int(result.deleted_count)

    def clear_table(self, table: str, schema: str | None = None) -> int:
        self.ensure_writable()
        database = self._database(schema)
        try:
            result = database[table].delete_many({})
        except Exception as exc:
            raise DBError(f"清空失败：{self.clean_error(exc)}", kind="write_error") from exc
        return int(result.deleted_count)

    def count_rows(self, table: str, schema: str | None = None) -> int:
        database = self._database(schema)
        return int(database[table].estimated_document_count())

    def create_table(self, spec: dict[str, Any], schema: str | None = None) -> None:
        self.ensure_writable()
        database = self._database(schema)
        name = spec.get("name") or spec.get("table")
        if not name:
            raise DBError("集合名称不能为空")
        try:
            if name not in database.list_collection_names():
                database.create_collection(name)
        except Exception as exc:
            raise DBError(f"创建集合失败：{self.clean_error(exc)}", kind="ddl_error") from exc

    def execute_statement(self, sql: str, max_rows: int = 200) -> dict[str, Any]:
        raise DBError("MongoDB 不支持 SQL，请使用文档查询面板", kind="unsupported")

    def resolve_table(self, table: str, schema: str | None = None) -> TableInfo:
        return self.get_table_detail(table, schema)

    def mongo_query(
        self, payload: dict[str, Any], schema: str | None = None
    ) -> dict[str, Any]:
        started = time.perf_counter()
        operation = str(payload.get("operation") or "find")
        if operation in BLOCKED_OPERATIONS:
            raise DBError(f"已拦截高危 MongoDB 操作：{operation}", kind="blocked")
        database = self._database(payload.get("database") or schema)
        collection_name = payload.get("collection")
        if not collection_name:
            raise DBError("请选择或输入集合名称")
        if collection_name not in database.list_collection_names():
            raise DBError(f"集合不存在：{collection_name}", kind="not_found")
        collection = database[collection_name]
        if self.read_only and operation in {
            "insertOne",
            "insertMany",
            "updateOne",
            "updateMany",
            "deleteOne",
            "deleteMany",
        }:
            raise DBError("当前连接已开启只读模式，禁止写入", kind="read_only")
        limit = max(1, min(int(payload.get("limit") or 50), 500))
        query_filter = payload.get("filter") or {}
        if not isinstance(query_filter, dict):
            raise DBError("filter 必须是 JSON 对象")
        if _contains_blocked(query_filter, BLOCKED_OPERATORS):
            raise DBError("查询中包含被禁用的操作符（$where/$function/$accumulator）", kind="blocked")
        if operation in ("find", "countDocuments"):
            total = int(collection.count_documents(query_filter, maxTimeMS=15000))
            if operation == "countDocuments":
                rows: list[dict[str, Any]] = [{"count": total}]
                columns = [{"name": "count", "type": "int"}]
            else:
                cursor = collection.find(
                    query_filter, payload.get("projection") or None
                )
                sort = payload.get("sort") or {}
                if isinstance(sort, dict) and sort:
                    cursor = cursor.sort(list(sort.items()))
                cursor = cursor.skip(int(payload.get("skip") or 0)).limit(limit + 1)
                documents = list(cursor)
                truncated = len(documents) > limit
                rows = [safe_row(document) for document in documents[:limit]]
                columns = self._columns_from_rows(rows)
            return {
                "columns": columns,
                "rows": rows,
                "row_count": len(rows),
                "total": total,
                "affected": 0,
                "truncated": len(rows) > limit if operation == "find" else False,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "kind": "select",
            }
        if operation == "aggregate":
            pipeline = payload.get("pipeline") or []
            if not isinstance(pipeline, list):
                raise DBError("pipeline 必须是 JSON 数组")
            if _contains_blocked(pipeline, BLOCKED_OPERATORS | BLOCKED_PIPELINE_STAGES):
                raise DBError("聚合管道包含被禁用的阶段（$out/$merge/$where/$function）", kind="blocked")
            documents = list(collection.aggregate(pipeline).limit(limit))
            rows = [safe_row(document) for document in documents]
            return {
                "columns": self._columns_from_rows(rows),
                "rows": rows,
                "row_count": len(rows),
                "total": len(rows),
                "affected": 0,
                "truncated": len(rows) >= limit,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "kind": "select",
            }
        if operation == "distinct":
            field = payload.get("field")
            if not field:
                raise DBError("distinct 需要 field")
            values = collection.distinct(field, query_filter)
            rows = [{field: json_safe(value)} for value in values[:limit]]
            return {
                "columns": [{"name": field, "type": "mixed"}],
                "rows": rows,
                "row_count": len(rows),
                "total": len(values),
                "affected": 0,
                "truncated": len(values) > limit,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "kind": "select",
            }
        if operation == "insertOne":
            document = payload.get("document")
            if not isinstance(document, dict):
                raise DBError("document 必须是 JSON 对象")
            result = collection.insert_one(document)
            return self._write_result(result, started, inserted=1)
        if operation == "insertMany":
            documents = payload.get("documents")
            if not isinstance(documents, list) or not documents:
                raise DBError("documents 必须是非空 JSON 数组")
            result = collection.insert_many(documents)
            return self._write_result(result, started, inserted=len(result.inserted_ids))
        if operation in ("updateOne", "updateMany"):
            update = payload.get("update")
            if not isinstance(update, dict) or not update:
                raise DBError("update 必须是 JSON 对象")
            if "$set" not in update:
                update = {"$set": update}
            if _contains_blocked(update, BLOCKED_OPERATORS):
                raise DBError("更新语句包含被禁用的操作符", kind="blocked")
            if not query_filter:
                raise DBError("为防止误操作，更新必须提供非空 filter", kind="blocked")
            method = collection.update_one if operation == "updateOne" else collection.update_many
            result = method(query_filter, update)
            return self._write_result(result, started, updated=result.modified_count)
        if operation in ("deleteOne", "deleteMany"):
            if not query_filter:
                raise DBError("为防止误操作，删除必须提供非空 filter", kind="blocked")
            method = collection.delete_one if operation == "deleteOne" else collection.delete_many
            result = method(query_filter)
            return self._write_result(result, started, deleted=result.deleted_count)
        raise DBError(f"不支持的操作：{operation}")

    def _write_result(self, result: Any, started: float, **extra: int) -> dict[str, Any]:
        return {
            "columns": [],
            "rows": [],
            "row_count": 0,
            "total": 0,
            "affected": int(
                extra.get("inserted")
                or extra.get("updated")
                or extra.get("deleted")
                or 0
            ),
            "truncated": False,
            "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            "kind": "write",
            **extra,
        }

    def _columns_from_rows(self, rows: list[dict[str, Any]]) -> list[dict[str, str]]:
        types: dict[str, set[str]] = {}
        for row in rows:
            for key, value in row.items():
                types.setdefault(key, set()).add(_type_name(value))
        return [
            {"name": key, "type": " | ".join(sorted(values))}
            for key, values in types.items()
        ]

    def _cursor(self) -> Any:
        raise DBError("MongoDB 不支持 SQL 游标", kind="unsupported")
