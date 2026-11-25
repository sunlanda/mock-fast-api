"""Response envelope presets used by generated mock endpoints."""

from __future__ import annotations

import math
from typing import Any

FORMATS: list[dict[str, str]] = [
    {
        "id": "result.data.pagination",
        "label": "result.data.pagination",
        "name": "Ant Design Pro 风",
        "description": "列表在 result.data.list，分页在 result.data.pagination，适合中后台。",
        "example": (
            '{\n  "code": 0,\n  "message": "ok",\n  "result": {\n'
            '    "data": {\n      "list": [],\n'
            '      "pagination": {"page": 1, "pageSize": 10, "total": 24, "totalPages": 3}\n'
            "    }\n  }\n}"
        ),
    },
    {
        "id": "data.data",
        "label": "data.data",
        "name": "双层 data",
        "description": "列表在 data.data，分页字段与列表平级，适合已有 axios 拦截器的项目。",
        "example": (
            '{\n  "code": 200,\n  "message": "success",\n  "data": {\n'
            '    "data": [],\n    "total": 24,\n    "page": 1,\n'
            '    "pageSize": 10\n  }\n}'
        ),
    },
    {
        "id": "data.list",
        "label": "data.list",
        "name": "标准列表",
        "description": "列表在 data.list，字段扁平，接入成本最低。",
        "example": (
            '{\n  "code": 0,\n  "message": "ok",\n  "data": {\n'
            '    "list": [],\n    "total": 24,\n    "page": 1,\n'
            '    "pageSize": 10\n  }\n}'
        ),
    },
    {
        "id": "raw",
        "label": "raw array",
        "name": "裸数组",
        "description": "直接返回数组 / 对象，适合快速原型或第三方 SDK。",
        "example": "[\n  { \"id\": 1 },\n  { \"id\": 2 }\n]",
    },
]

FORMAT_IDS = {item["id"] for item in FORMATS}
DEFAULT_FORMAT = "result.data.pagination"


def _pagination(page: int, page_size: int, total: int) -> dict[str, int]:
    return {
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": max(1, math.ceil(total / page_size)) if page_size else 1,
    }


def wrap_list(
    response_format: str,
    rows: list[dict[str, Any]],
    page: int,
    page_size: int,
    total: int,
) -> Any:
    if response_format == "data.data":
        return {
            "code": 200,
            "message": "success",
            "data": {
                "data": rows,
                "total": total,
                "page": page,
                "pageSize": page_size,
                "totalPages": max(1, math.ceil(total / page_size)) if page_size else 1,
            },
        }
    if response_format == "data.list":
        return {
            "code": 0,
            "message": "ok",
            "data": {
                "list": rows,
                "total": total,
                "page": page,
                "pageSize": page_size,
                "totalPages": max(1, math.ceil(total / page_size)) if page_size else 1,
            },
        }
    if response_format == "raw":
        return rows
    return {
        "code": 0,
        "message": "ok",
        "result": {
            "data": {
                "list": rows,
                "pagination": _pagination(page, page_size, total),
            }
        },
    }


def wrap_item(response_format: str, item: Any) -> Any:
    if response_format == "data.data":
        return {"code": 200, "message": "success", "data": {"data": item}}
    if response_format == "data.list":
        return {"code": 0, "message": "ok", "data": item}
    if response_format == "raw":
        return item
    return {"code": 0, "message": "ok", "result": {"data": item}}


def wrap_error(response_format: str, status: int, message: str) -> Any:
    if response_format == "data.data":
        return {"code": status, "message": message, "data": {"data": None}}
    if response_format == "data.list":
        return {"code": status, "message": message, "data": None}
    if response_format == "raw":
        return {"error": True, "status": status, "message": message}
    return {
        "code": status,
        "message": message,
        "result": {"data": None},
    }


def format_public() -> list[dict[str, str]]:
    return FORMATS


def endpoint_definitions(slug: str, table: str) -> list[dict[str, str]]:
    base = f"/mock/{slug}"
    return [
        {
            "method": "GET",
            "path": base,
            "label": "分页列表",
            "hint": "?page=1&pageSize=10&_sort=id&_order=desc&_q=关键词",
        },
        {
            "method": "GET",
            "path": f"{base}/{table}/:id",
            "label": "单条详情",
            "hint": "主键路径参数",
        },
        {
            "method": "POST",
            "path": f"{base}/{table}",
            "label": "新增数据",
            "hint": "JSON body，字段名与表字段一致",
        },
        {
            "method": "PATCH",
            "path": f"{base}/{table}/:id",
            "label": "更新数据",
            "hint": "仅更新 body 中出现的字段",
        },
        {
            "method": "DELETE",
            "path": f"{base}/{table}/:id",
            "label": "删除数据",
            "hint": "返回删除结果",
        },
        {
            "method": "GET",
            "path": f"{base}/__meta",
            "label": "项目元信息",
            "hint": "表名、主键、响应格式",
        },
    ]
