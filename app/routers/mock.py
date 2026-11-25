"""Generated mock API endpoints served under /mock/{slug}."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from .. import store
from ..db.base import DBError
from ..mock_format import FORMAT_IDS, format_public, wrap_error, wrap_item, wrap_list
from ..seed import mock_default_value
from ..services import adapter_for, project_public

router = APIRouter(prefix="/mock", tags=["mock"])

RESERVED_PARAMS = {
    "page",
    "pageSize",
    "page_size",
    "size",
    "limit",
    "_page",
    "_limit",
    "_sort",
    "sort",
    "_order",
    "order",
    "_q",
    "q",
    "_format",
    "_delay",
    "_callback",
}


def _get_project(slug: str) -> dict[str, Any]:
    project = store.get_project_by_slug(slug)
    if not project:
        raise DBError(f"Mock 项目不存在：{slug}", kind="not_found")
    return project


def _format(project: dict[str, Any], request: Request) -> str:
    requested = request.query_params.get("_format")
    if requested in FORMAT_IDS:
        return requested
    return project["response_format"]


def _status_for(exc: DBError) -> int:
    if exc.kind == "not_found":
        return 404
    if exc.kind in ("read_only", "policy_error"):
        return 403
    return 400


def _headers(project: dict[str, Any], fmt: str, **extra: Any) -> dict[str, str]:
    headers = {
        "Cache-Control": "no-store",
        "X-Mock-Source": "MockFast",
        "X-Mock-Project": project["slug"],
        "X-Mock-Table": project["table_name"],
        "X-Mock-Format": fmt,
    }
    for key, value in extra.items():
        if value is not None:
            headers[f"X-Mock-{key}"] = str(value)
    return headers


def _delay(request: Request) -> int:
    raw = request.query_params.get("_delay")
    try:
        value = int(float(raw)) if raw else 0
    except (TypeError, ValueError):
        value = 0
    value = max(0, min(value, 3000))
    if value:
        time.sleep(value / 1000)
    return value


def _pagination(request: Request) -> tuple[int, int]:
    params = request.query_params

    def pick(*names: str) -> str | None:
        for name in names:
            value = params.get(name)
            if value not in (None, ""):
                return value
        return None

    try:
        page = int(pick("page", "_page") or 1)
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(pick("pageSize", "page_size", "size", "limit", "_limit") or 10)
    except (TypeError, ValueError):
        page_size = 10
    return max(1, page), max(1, min(page_size, 200))


def _filters(request: Request) -> dict[str, str]:
    return {
        key: value
        for key, value in request.query_params.items()
        if key not in RESERVED_PARAMS and value != ""
    }


def _error_response(
    project: dict[str, Any], fmt: str, exc: DBError
) -> JSONResponse:
    status = _status_for(exc)
    return JSONResponse(
        status_code=status,
        content=wrap_error(fmt, status, exc.message),
        headers=_headers(project, fmt, Error=exc.kind),
    )


def _fill_create_payload(
    adapter: Any,
    table: str,
    schema: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Be forgiving on create: fill missing NOT NULL fields with mock values."""
    if getattr(adapter, "kind", "") == "mongodb":
        return payload
    info = adapter.get_table_detail(table, schema)
    data = dict(payload)
    for column in info.columns:
        if column.primary_key or column.auto_increment:
            continue
        if data.get(column.name) not in (None, ""):
            continue
        if not column.nullable and column.default is None:
            data[column.name] = mock_default_value(column)
    return data


def _table_name(project: dict[str, Any], table: str) -> str:
    expected = project["table_name"]
    connection = store.get_connection(project["connection_id"])
    kind = connection["kind"] if connection else None
    if kind == "mongodb":
        matches = table == expected
    else:
        matches = table.lower() == expected.lower()
    if not matches:
        raise DBError(
            f"该项目只暴露表 {expected}，当前请求为 {table}", kind="not_found"
        )
    return expected


def _list(
    project: dict[str, Any], request: Request, table: str
) -> JSONResponse:
    fmt = _format(project, request)
    delay = _delay(request)
    page, page_size = _pagination(request)
    params = request.query_params
    sort = params.get("_sort") or params.get("sort")
    order = params.get("_order") or params.get("order") or "asc"
    search = params.get("_q") or params.get("q")
    try:
        with adapter_for(project["connection_id"]) as (adapter, _row):
            data = adapter.list_rows(
                table,
                project.get("schema_name"),
                page=page,
                page_size=page_size,
                sort=sort,
                order=order,
                filters=_filters(request),
                search=search,
            )
    except DBError as exc:
        return _error_response(project, fmt, exc)
    body = wrap_list(fmt, data["rows"], data["page"], data["page_size"], data["total"])
    return JSONResponse(
        status_code=200,
        content=body,
        headers=_headers(
            project,
            fmt,
            Page=data["page"],
            PageSize=data["page_size"],
            Total=data["total"],
            TotalPages=data["total_pages"],
            Delay=delay or None,
        ),
    )


@router.get("/{slug}/__meta")
def mock_meta(slug: str) -> dict[str, Any]:
    project = _get_project(slug)
    public = project_public(project)
    return {
        "project": public,
        "endpoints": public["endpoints"],
        "formats": format_public(),
        "query_params": {
            "page": "页码，默认 1",
            "pageSize": "每页条数，默认 10，最大 200",
            "_sort": "排序字段，默认主键",
            "_order": "asc / desc",
            "_q": "跨文本字段模糊搜索",
            "_format": "临时覆盖响应格式",
            "_delay": "模拟延迟毫秒，最大 3000",
            "其他参数": "自动作为字段等值筛选，支持 __like / __gt / __lt / __neq",
        },
    }


@router.get("/{slug}")
def mock_list_root(slug: str, request: Request) -> JSONResponse:
    project = _get_project(slug)
    return _list(project, request, project["table_name"])


@router.get("/{slug}/{table}")
def mock_list(slug: str, table: str, request: Request) -> JSONResponse:
    project = _get_project(slug)
    fmt = _format(project, request)
    try:
        actual = _table_name(project, table)
    except DBError as exc:
        return _error_response(project, fmt, exc)
    return _list(project, request, actual)


@router.post("/{slug}/{table}", status_code=201)
def mock_create(
    slug: str, table: str, request: Request, payload: Any = Body(...)
) -> JSONResponse:
    project = _get_project(slug)
    fmt = _format(project, request)
    try:
        actual = _table_name(project, table)
        if not isinstance(payload, dict):
            raise DBError("请求体必须是 JSON 对象", kind="config_error")
        with adapter_for(project["connection_id"]) as (adapter, _row):
            prepared = _fill_create_payload(
                adapter, actual, project.get("schema_name"), payload
            )
            row = adapter.insert_row(actual, prepared, project.get("schema_name"))
    except DBError as exc:
        return _error_response(project, fmt, exc)
    return JSONResponse(
        status_code=201,
        content=wrap_item(fmt, row),
        headers=_headers(project, fmt),
    )


@router.get("/{slug}/{table}/{pk}")
def mock_detail(
    slug: str, table: str, pk: str, request: Request
) -> JSONResponse:
    project = _get_project(slug)
    fmt = _format(project, request)
    _delay(request)
    try:
        actual = _table_name(project, table)
        with adapter_for(project["connection_id"]) as (adapter, _row):
            row = adapter.get_row(actual, pk, project.get("schema_name"))
        if row is None:
            raise DBError("记录不存在", kind="not_found")
    except DBError as exc:
        return _error_response(project, fmt, exc)
    return JSONResponse(
        status_code=200, content=wrap_item(fmt, row), headers=_headers(project, fmt)
    )


@router.patch("/{slug}/{table}/{pk}")
def mock_update(
    slug: str, table: str, pk: str, request: Request, payload: Any = Body(...)
) -> JSONResponse:
    project = _get_project(slug)
    fmt = _format(project, request)
    _delay(request)
    try:
        actual = _table_name(project, table)
        if not isinstance(payload, dict):
            raise DBError("请求体必须是 JSON 对象", kind="config_error")
        with adapter_for(project["connection_id"]) as (adapter, _row):
            row = adapter.update_row(
                actual, pk, payload, project.get("schema_name")
            )
        if row is None:
            raise DBError("记录不存在", kind="not_found")
    except DBError as exc:
        return _error_response(project, fmt, exc)
    return JSONResponse(
        status_code=200, content=wrap_item(fmt, row), headers=_headers(project, fmt)
    )


@router.delete("/{slug}/{table}/{pk}")
def mock_delete(
    slug: str, table: str, pk: str, request: Request
) -> JSONResponse:
    project = _get_project(slug)
    fmt = _format(project, request)
    _delay(request)
    try:
        actual = _table_name(project, table)
        with adapter_for(project["connection_id"]) as (adapter, _row):
            deleted = adapter.delete_row(actual, pk, project.get("schema_name"))
        if not deleted:
            raise DBError("记录不存在", kind="not_found")
    except DBError as exc:
        return _error_response(project, fmt, exc)
    return JSONResponse(
        status_code=200,
        content=wrap_item(fmt, {"id": pk, "deleted": True}),
        headers=_headers(project, fmt),
    )
