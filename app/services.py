"""Business services shared by the HTTP routes."""

from __future__ import annotations

import json
import re
from contextlib import contextmanager
from typing import Any, Iterator

from . import store
from .db.base import DBError
from .db.factory import KIND_LABELS, build_adapter, normalize_config, test_connection
from .mock_format import (
    DEFAULT_FORMAT,
    FORMAT_IDS,
    endpoint_definitions,
    wrap_item,
    wrap_list,
)
from .security import analyze_sql
from .seed import generate_generic_rows
from .templates import TEMPLATE_MAP, generate_rows

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
SQL_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
MONGO_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}$")


def _stored_config(row: dict[str, Any]) -> dict[str, Any]:
    return json.loads(row.get("config") or "{}")


@contextmanager
def adapter_for(connection_id: str) -> Iterator[tuple[Any, dict[str, Any]]]:
    row = store.get_connection(connection_id)
    if not row:
        raise DBError("数据库连接不存在", kind="not_found")
    if row["is_remote"] and not store.allow_remote_db():
        raise DBError(
            "远程数据库访问已被关闭。请到「设置 → 数据源安全策略」中开启远程访问。",
            kind="policy_error",
        )
    adapter = build_adapter(
        row["kind"], _stored_config(row), read_only=bool(row["read_only"])
    )
    try:
        adapter.ensure()
        yield adapter, row
    finally:
        adapter.close()


def _default_schema(adapter: Any, row: dict[str, Any]) -> str | None:
    if row["kind"] == "sqlite":
        return "main"
    if hasattr(adapter, "default_schema"):
        try:
            return adapter.default_schema()
        except Exception:
            pass
    return _stored_config(row).get("database")


# --------------------------------------------------------------------------- #
# connections
# --------------------------------------------------------------------------- #


def test_connection_payload(
    kind: str,
    config: dict[str, Any],
    connection_id: str | None = None,
) -> dict[str, Any]:
    config = dict(config or {})
    if connection_id:
        row = store.get_connection(connection_id)
        if row:
            stored = _stored_config(row)
            kind = kind or row["kind"]
            if not config.get("password") and stored.get("password"):
                config["password"] = stored["password"]
            if kind == "mongodb" and not config.get("uri") and stored.get("uri"):
                config["uri"] = stored["uri"]
    config = normalize_config(kind, config)
    is_remote = store.connection_is_remote(kind, config)
    if is_remote and not store.allow_remote_db():
        raise DBError(
            "远程数据库访问已关闭。默认只允许 localhost / 127.0.0.1；"
            "如确认需要连接远程开发库，请到设置中开启并建议使用只读连接。",
            kind="policy_error",
        )
    result = test_connection(kind, config)
    result["is_remote"] = is_remote
    return result


def create_connection(
    name: str,
    kind: str,
    config: dict[str, Any],
    read_only: bool | None = None,
) -> dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise DBError("连接名称不能为空", kind="config_error")
    config = normalize_config(kind, config)
    is_remote = store.connection_is_remote(kind, config)
    if is_remote and not store.allow_remote_db():
        raise DBError(
            "远程数据库访问已关闭，请先在设置中开启远程访问策略。",
            kind="policy_error",
        )
    if read_only is None:
        read_only = is_remote
    return store.create_connection(
        name=name,
        kind=kind,
        config=config,
        read_only=bool(read_only),
        is_remote=is_remote,
    )


def update_connection(
    connection_id: str,
    *,
    name: str | None,
    config: dict[str, Any] | None,
    read_only: bool | None,
) -> dict[str, Any]:
    row = store.get_connection(connection_id)
    if not row:
        raise DBError("数据库连接不存在", kind="not_found")
    next_config: dict[str, Any] | None = None
    is_remote = bool(row["is_remote"])
    if config is not None:
        stored = _stored_config(row)
        config = dict(config)
        if (
            row["kind"] == "mongodb"
            and stored.get("uri")
            and not config.get("uri")
            and config.get("keep_uri")
        ):
            config["uri"] = stored["uri"]
        config.pop("keep_uri", None)
        next_config = normalize_config(row["kind"], config)
        is_remote = store.connection_is_remote(row["kind"], next_config)
        if is_remote and not store.allow_remote_db():
            raise DBError(
                "远程数据库访问已关闭，请先在设置中开启远程访问策略。",
                kind="policy_error",
            )
    updated = store.update_connection(
        connection_id,
        name=(name or "").strip() or None,
        config=next_config,
        read_only=read_only,
        is_remote=is_remote,
    )
    if not updated:
        raise DBError("数据库连接不存在", kind="not_found")
    return updated


def delete_connection(connection_id: str) -> None:
    if any(
        project["connection_id"] == connection_id for project in store.list_projects()
    ):
        raise DBError(
            "该连接仍被 Mock 项目使用，请先删除相关项目再移除连接。", kind="conflict"
        )
    store.delete_connection(connection_id)


# --------------------------------------------------------------------------- #
# projects
# --------------------------------------------------------------------------- #


def _slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return value[:40]


def unique_slug(preferred: str, fallback: str) -> str:
    base = _slugify(preferred) or _slugify(fallback) or "mock-api"
    if not SLUG_RE.match(base):
        base = re.sub(r"[^a-z0-9-]", "", base)[:40] or "mock-api"
    candidate = base
    counter = 2
    while store.slug_exists(candidate):
        suffix = f"-{counter}"
        candidate = f"{base[: 40 - len(suffix)]}{suffix}"
        counter += 1
    return candidate


def validate_table_name(kind: str, name: str) -> str:
    name = (name or "").strip()
    if kind == "mongodb":
        if not MONGO_IDENTIFIER_RE.match(name) or name.startswith("system."):
            raise DBError("集合名只能包含字母、数字、下划线、点或短横线", kind="config_error")
        return name
    if not SQL_IDENTIFIER_RE.match(name):
        raise DBError("表名只能包含字母、数字、下划线，且不能以数字开头", kind="config_error")
    return name


def project_public(project: dict[str, Any]) -> dict[str, Any]:
    connection = store.get_connection_public(project["connection_id"])
    item = dict(project)
    item["connection_name"] = connection["name"] if connection else "连接已删除"
    item["connection_kind"] = connection["kind"] if connection else None
    item["connection_kind_label"] = (
        KIND_LABELS.get(connection["kind"], connection["kind"]) if connection else None
    )
    item["endpoints"] = endpoint_definitions(
        project["slug"], project["table_name"]
    )
    item["url"] = f"/mock/{project['slug']}"
    item["format"] = project["response_format"]
    return item


def list_projects_public() -> list[dict[str, Any]]:
    return [project_public(project) for project in store.list_projects()]


def project_by_slug_public(slug: str) -> dict[str, Any] | None:
    project = store.get_project_by_slug(slug)
    return project_public(project) if project else None


def create_project(payload: dict[str, Any]) -> dict[str, Any]:
    connection_id = payload.get("connection_id")
    if not connection_id:
        raise DBError("请选择数据库连接", kind="config_error")
    connection = store.get_connection(connection_id)
    if not connection:
        raise DBError("数据库连接不存在", kind="not_found")
    template_id = payload.get("template_id")
    template = TEMPLATE_MAP.get(template_id) if template_id else None
    if template_id and not template:
        raise DBError(f"模板不存在：{template_id}", kind="config_error")
    name = (payload.get("name") or (template["name"] if template else "自定义接口")).strip()
    if len(name) > 80:
        raise DBError("项目名称最多 80 个字符", kind="config_error")
    response_format = payload.get("response_format") or DEFAULT_FORMAT
    if response_format not in FORMAT_IDS:
        raise DBError(f"不支持的响应格式：{response_format}", kind="config_error")
    table_name = validate_table_name(
        connection["kind"],
        payload.get("table_name") or (template["table"] if template else ""),
    )
    if not table_name:
        raise DBError("表名不能为空", kind="config_error")
    seed_count = int(payload.get("seed_count") if payload.get("seed_count") is not None else (18 if template else 0))
    seed_count = max(0, min(seed_count, 100))
    slug = unique_slug(
        payload.get("slug") or "",
        template_id or table_name,
    )
    warnings: list[str] = []
    seeded = 0
    existing_table = False
    schema_name: str | None = None
    pk_column = "_id" if connection["kind"] == "mongodb" else "id"
    with adapter_for(connection_id) as (adapter, row):
        schema_name = payload.get("schema_name") or _default_schema(adapter, row)
        try:
            detail = adapter.get_table_detail(table_name, schema_name)
            existing_table = True
        except DBError as exc:
            if exc.kind != "not_found":
                raise
            if not template:
                raise DBError(
                    f"表 {table_name} 不存在。请使用模板创建，或先到 SQL 控制台建表。",
                    kind="not_found",
                )
            adapter.create_table(
                {"name": table_name, "columns": template["columns"]}, schema_name
            )
        if seed_count:
            if template:
                rows = generate_rows(
                    template_id,
                    seed_count,
                    max(1, int(adapter.count_rows(table_name, schema_name) or 0) + 1),
                )
            else:
                detail = adapter.get_table_detail(table_name, schema_name)
                rows = generate_generic_rows(detail, seed_count, 1)
            if not rows:
                warnings.append("没有推断出可写入的字段，已跳过种子数据。")
            for index, data in enumerate(rows):
                try:
                    adapter.insert_row(table_name, data, schema_name)
                    seeded += 1
                except DBError as exc:
                    if len(warnings) < 3:
                        warnings.append(f"第 {index + 1} 条种子数据写入失败：{exc.message}")
        try:
            detail = adapter.get_table_detail(table_name, schema_name)
            pk_column = detail.primary_key or pk_column
        except DBError:
            pass
    if existing_table and template:
        warnings.append("目标表已存在，已直接复用它并追加种子数据。")
    project = store.create_project(
        name=name,
        slug=slug,
        connection_id=connection_id,
        table_name=table_name,
        schema_name=schema_name,
        pk_column=pk_column,
        response_format=response_format,
        template_id=template_id if template else None,
    )
    return {
        "project": project_public(project),
        "warnings": warnings,
        "seeded": seeded,
        "existing_table": existing_table,
    }


def update_project(
    project_id: str, *, name: str | None, response_format: str | None
) -> dict[str, Any]:
    project = store.get_project(project_id)
    if not project:
        raise DBError("Mock 项目不存在", kind="not_found")
    if response_format and response_format not in FORMAT_IDS:
        raise DBError(f"不支持的响应格式：{response_format}", kind="config_error")
    updated = store.update_project(
        project_id, name=name, response_format=response_format
    )
    return project_public(updated)  # type: ignore[arg-type]


def delete_project(project_id: str) -> None:
    project = store.get_project(project_id)
    if not project:
        raise DBError("Mock 项目不存在", kind="not_found")
    store.delete_project(project_id)


def seed_project(project_id: str, count: int) -> dict[str, Any]:
    project = store.get_project(project_id)
    if not project:
        raise DBError("Mock 项目不存在", kind="not_found")
    count = max(1, min(int(count), 100))
    template = TEMPLATE_MAP.get(project.get("template_id") or "")
    inserted = 0
    errors: list[str] = []
    with adapter_for(project["connection_id"]) as (adapter, _row):
        try:
            existing_count = int(
                adapter.count_rows(project["table_name"], project.get("schema_name"))
            )
        except DBError:
            existing_count = 0
        if template:
            rows = generate_rows(
                project["template_id"], count, start_index=existing_count + 1
            )
        else:
            detail = adapter.get_table_detail(
                project["table_name"], project.get("schema_name")
            )
            rows = generate_generic_rows(detail, count, existing_count + 1)
        if not rows:
            raise DBError("该表没有可用于生成的字段", kind="config_error")
        for index, data in enumerate(rows):
            try:
                adapter.insert_row(
                    project["table_name"], data, project.get("schema_name")
                )
                inserted += 1
            except DBError as exc:
                if len(errors) < 3:
                    errors.append(f"第 {index + 1} 条写入失败：{exc.message}")
    return {
        "inserted": inserted,
        "requested": count,
        "errors": errors,
        "project_id": project_id,
    }


def preview_project(
    project_id: str, *, page: int = 1, page_size: int = 3
) -> dict[str, Any]:
    project = store.get_project(project_id)
    if not project:
        raise DBError("Mock 项目不存在", kind="not_found")
    with adapter_for(project["connection_id"]) as (adapter, _row):
        data = adapter.list_rows(
            project["table_name"],
            project.get("schema_name"),
            page=max(1, page),
            page_size=max(1, min(page_size, 50)),
        )
    body = wrap_list(
        project["response_format"],
        data["rows"],
        data["page"],
        data["page_size"],
        data["total"],
    )
    return {
        "format": project["response_format"],
        "body": body,
        "meta": {
            "page": data["page"],
            "pageSize": data["page_size"],
            "total": data["total"],
            "totalPages": data["total_pages"],
            "table": project["table_name"],
        },
    }


def seed_table(
    connection_id: str, table: str, schema_name: str | None, count: int
) -> dict[str, Any]:
    count = max(1, min(int(count), 100))
    inserted = 0
    errors: list[str] = []
    with adapter_for(connection_id) as (adapter, _row):
        detail = adapter.get_table_detail(table, schema_name)
        existing = int(adapter.count_rows(table, schema_name) or 0)
        rows = generate_generic_rows(detail, count, existing + 1)
        if not rows:
            raise DBError("该表没有可用于生成的字段", kind="config_error")
        for index, data in enumerate(rows):
            try:
                adapter.insert_row(table, data, schema_name)
                inserted += 1
            except DBError as exc:
                if len(errors) < 3:
                    errors.append(f"第 {index + 1} 条写入失败：{exc.message}")
    return {"inserted": inserted, "requested": count, "errors": errors}


# --------------------------------------------------------------------------- #
# SQL / Mongo console
# --------------------------------------------------------------------------- #


def analyze(connection_id: str | None, sql: str, allow_ddl: bool = False) -> dict[str, Any]:
    read_only = False
    if connection_id:
        row = store.get_connection(connection_id)
        read_only = bool(row["read_only"]) if row else False
    result = analyze_sql(sql, allow_ddl=allow_ddl, read_only=read_only)
    return result.to_dict()


def execute_sql(
    connection_id: str,
    sql: str,
    *,
    allow_ddl: bool = False,
    ddl_token: str | None = None,
    max_rows: int = 200,
) -> dict[str, Any]:
    row = store.get_connection(connection_id)
    if not row:
        raise DBError("数据库连接不存在", kind="not_found")
    if row["kind"] == "mongodb":
        raise DBError("MongoDB 请使用文档查询面板", kind="unsupported")
    guard = analyze_sql(
        sql, allow_ddl=allow_ddl, read_only=bool(row["read_only"])
    )
    if not guard.allowed:
        raise DBError(
            "SQL 已被安全策略拦截",
            kind="blocked",
            detail={"reasons": guard.reasons, "classification": guard.classification},
        )
    if guard.requires_ddl and ddl_token != "ALLOW_DDL":
        raise DBError(
            "结构变更需要二次确认：请勾选 DDL 开关并在确认框中提交。",
            kind="blocked",
            detail={"reasons": ["缺少 DDL 二次确认令牌"]},
        )
    max_rows = max(1, min(int(max_rows or 200), 500))
    results: list[dict[str, Any]] = []
    with adapter_for(connection_id) as (adapter, _row):
        for index, statement in enumerate(guard.statements):
            try:
                results.append(adapter.execute_statement(statement, max_rows=max_rows))
            except DBError as exc:
                prefix = (
                    f"第 {index + 1} 条语句失败"
                    + ("（此前语句可能已提交）" if index else "")
                    + "："
                )
                raise DBError(
                    prefix + exc.message,
                    kind=exc.kind,
                    detail=exc.detail,
                ) from exc
    return {
        "guard": guard.to_dict(),
        "results": results,
        "result": results[-1] if results else None,
    }


def execute_mongo(
    connection_id: str, payload: dict[str, Any], schema: str | None = None
) -> dict[str, Any]:
    with adapter_for(connection_id) as (adapter, row):
        if row["kind"] != "mongodb":
            raise DBError("该连接不是 MongoDB", kind="config_error")
        result = adapter.mongo_query(payload, schema)
    return result
