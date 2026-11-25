"""Connection management endpoints."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from .. import store
from ..db.base import DBError
from ..db.factory import test_connection
from ..services import (
    create_connection,
    delete_connection,
    test_connection_payload,
    update_connection,
)

router = APIRouter(prefix="/api/connections", tags=["connections"])


class ConnectionPayload(BaseModel):
    name: str = ""
    kind: str
    config: dict[str, Any] = Field(default_factory=dict)
    read_only: bool | None = None


class ConnectionUpdatePayload(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    read_only: bool | None = None


class ConnectionTestPayload(BaseModel):
    kind: str
    config: dict[str, Any] = Field(default_factory=dict)
    connection_id: str | None = None


@router.get("")
def get_connections() -> dict[str, Any]:
    return {"items": store.list_connections()}


@router.post("", status_code=201)
def add_connection(payload: ConnectionPayload) -> dict[str, Any]:
    return create_connection(
        name=payload.name,
        kind=payload.kind,
        config=payload.config,
        read_only=payload.read_only,
    )


@router.put("/{connection_id}")
def edit_connection(
    connection_id: str, payload: ConnectionUpdatePayload
) -> dict[str, Any]:
    return update_connection(
        connection_id,
        name=payload.name,
        config=payload.config,
        read_only=payload.read_only,
    )


@router.delete("/{connection_id}", status_code=204)
def remove_connection(connection_id: str) -> Response:
    delete_connection(connection_id)
    return Response(status_code=204)


@router.post("/test")
def test_unsaved_connection(payload: ConnectionTestPayload) -> dict[str, Any]:
    return test_connection_payload(
        payload.kind, payload.config, payload.connection_id
    )


@router.post("/{connection_id}/test")
def test_saved_connection(connection_id: str) -> dict[str, Any]:
    row = store.get_connection(connection_id)
    if not row:
        raise DBError("数据库连接不存在", kind="not_found")
    config = json.loads(row["config"] or "{}")
    if row["is_remote"] and not store.allow_remote_db():
        raise DBError(
            "远程数据库访问已被关闭。请到设置中重新开启远程访问。",
            kind="policy_error",
        )
    result = test_connection(row["kind"], config, read_only=bool(row["read_only"]))
    result["is_remote"] = bool(row["is_remote"])
    return result
