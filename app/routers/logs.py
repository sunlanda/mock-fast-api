"""Request log endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Response

from .. import store

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/stats")
def get_stats() -> dict[str, Any]:
    return store.log_stats()


@router.get("")
def get_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    project: str | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    kind: str | None = Query(default=None),
) -> dict[str, Any]:
    return store.list_logs(
        limit=limit,
        offset=offset,
        project=project,
        status=status,
        q=q,
        kind=kind,
    )


@router.delete("")
def clear_logs() -> dict[str, Any]:
    store.clear_logs()
    return {"ok": True}


@router.get("/{log_id}")
def get_log(log_id: int) -> dict[str, Any]:
    item = store.get_log(log_id)
    if not item:
        from ..db.base import DBError

        raise DBError("日志不存在", kind="not_found")
    return item
