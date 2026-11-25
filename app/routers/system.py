"""Health, settings and metadata endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from .. import __version__, store
from ..config import HOST, PORT

router = APIRouter(prefix="/api", tags=["system"])


class SettingsPayload(BaseModel):
    allow_remote_db: bool | None = None
    log_retention: int | None = None
    theme: str | None = None


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": __version__,
        "host": HOST,
        "port": PORT,
        "connections": len(store.list_connections()),
        "projects": store.count_projects(),
        "allow_remote_db": store.allow_remote_db(),
    }


@router.get("/settings")
def settings() -> dict[str, Any]:
    return store.get_settings()


@router.put("/settings")
def update_settings(payload: SettingsPayload) -> dict[str, Any]:
    patch = {
        key: value
        for key, value in payload.model_dump().items()
        if value is not None
    }
    return store.set_settings(patch)


@router.get("/meta")
def meta() -> dict[str, Any]:
    return {
        "name": "MockFast",
        "version": __version__,
        "host": HOST,
        "port": PORT,
        "allow_remote_db": store.allow_remote_db(),
        "settings": store.get_settings(),
    }
