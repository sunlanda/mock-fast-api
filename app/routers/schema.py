"""Schema introspection and table data endpoints."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Query
from pydantic import BaseModel, Field

from ..db.base import DBError
from ..services import (
    adapter_for,
    seed_table,
    validate_table_name,
)

router = APIRouter(prefix="/api/connections/{connection_id}", tags=["schema"])


class RowPayload(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class SeedPayload(BaseModel):
    count: int = 5


class ClearPayload(BaseModel):
    confirm: str = ""


class TableColumn(BaseModel):
    name: str
    type: str = "string"
    primary_key: bool = False
    auto_increment: bool = False
    nullable: bool = True
    default: Any = None


class CreateTablePayload(BaseModel):
    name: str
    columns: list[TableColumn]
    schema_name: str | None = None


@router.get("/schemas")
def get_schemas(connection_id: str) -> dict[str, Any]:
    with adapter_for(connection_id) as (adapter, row):
        schemas = adapter.list_schemas()
        default = None
        if hasattr(adapter, "default_schema"):
            try:
                default = adapter.default_schema()
            except Exception:
                default = None
        default = default or (schemas[0] if schemas else None)
        return {
            "schemas": schemas,
            "default": default,
            "kind": row["kind"],
            "read_only": bool(row["read_only"]),
        }


@router.get("/tables")
def get_tables(
    connection_id: str, schema: str | None = Query(default=None)
) -> dict[str, Any]:
    with adapter_for(connection_id) as (adapter, row):
        if not schema and hasattr(adapter, "default_schema"):
            schema = adapter.default_schema()
        tables = adapter.list_tables(schema)
        return {
            "schema": schema,
            "kind": row["kind"],
            "items": [
                {
                    "name": table.name,
                    "schema": table.schema,
                    "kind": table.kind,
                    "row_count": table.row_count,
                    "size": table.size,
                    "comment": table.comment,
                }
                for table in tables
            ],
        }


@router.get("/tables/{table}")
def get_table(
    connection_id: str, table: str, schema: str | None = Query(default=None)
) -> dict[str, Any]:
    with adapter_for(connection_id) as (adapter, _row):
        detail = adapter.get_table_detail(table, schema)
        return detail.to_dict()


@router.get("/tables/{table}/rows")
def get_rows(
    connection_id: str,
    table: str,
    schema: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    sort: str | None = Query(default=None),
    order: str = Query(default="asc"),
    q: str | None = Query(default=None),
    filters: str | None = Query(default=None),
) -> dict[str, Any]:
    parsed_filters: dict[str, Any] = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except ValueError as exc:
            raise DBError("filters 必须是合法 JSON", kind="config_error") from exc
        if not isinstance(parsed_filters, dict):
            raise DBError("filters 必须是 JSON 对象", kind="config_error")
    with adapter_for(connection_id) as (adapter, _row):
        return adapter.list_rows(
            table,
            schema,
            page=page,
            page_size=page_size,
            sort=sort,
            order=order,
            filters=parsed_filters,
            search=q,
        )


@router.post("/tables/{table}/rows", status_code=201)
def insert_row(
    connection_id: str,
    table: str,
    payload: RowPayload,
    schema: str | None = Query(default=None),
) -> dict[str, Any]:
    with adapter_for(connection_id) as (adapter, _row):
        row = adapter.insert_row(table, payload.data, schema)
    return {"row": row}


@router.patch("/tables/{table}/rows/{pk}")
def update_row(
    connection_id: str,
    table: str,
    pk: str,
    payload: RowPayload,
    schema: str | None = Query(default=None),
) -> dict[str, Any]:
    with adapter_for(connection_id) as (adapter, _row):
        row = adapter.update_row(table, pk, payload.data, schema)
    if row is None:
        raise DBError("记录不存在，或没有发生变更", kind="not_found")
    return {"row": row}


@router.delete("/tables/{table}/rows/{pk}")
def delete_row(
    connection_id: str,
    table: str,
    pk: str,
    schema: str | None = Query(default=None),
) -> dict[str, Any]:
    with adapter_for(connection_id) as (adapter, _row):
        deleted = adapter.delete_row(table, pk, schema)
    if not deleted:
        raise DBError("记录不存在", kind="not_found")
    return {"deleted": deleted, "id": pk}


@router.delete("/tables/{table}/rows")
def clear_table(
    connection_id: str,
    table: str,
    payload: ClearPayload,
    schema: str | None = Query(default=None),
) -> dict[str, Any]:
    if payload.confirm != "CLEAR":
        raise DBError(
            "清空表属于高风险操作，请在确认框中输入 CLEAR。", kind="blocked"
        )
    with adapter_for(connection_id) as (adapter, _row):
        deleted = adapter.clear_table(table, schema)
    return {"deleted": deleted}


@router.post("/tables/{table}/seed")
def seed_rows(
    connection_id: str,
    table: str,
    payload: SeedPayload,
    schema: str | None = Query(default=None),
) -> dict[str, Any]:
    return seed_table(connection_id, table, schema, payload.count)


@router.post("/tables", status_code=201)
def create_table(connection_id: str, payload: CreateTablePayload) -> dict[str, Any]:
    with adapter_for(connection_id) as (adapter, row):
        name = validate_table_name(row["kind"], payload.name)
        adapter.create_table(
            {
                "name": name,
                "columns": [column.model_dump() for column in payload.columns],
            },
            payload.schema_name,
        )
        detail = adapter.get_table_detail(name, payload.schema_name)
        return detail.to_dict()
