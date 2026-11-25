"""Mock project lifecycle endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field

from .. import store
from ..mock_format import format_public
from ..services import (
    create_project,
    delete_project,
    list_projects_public,
    preview_project,
    seed_project,
    update_project,
)
from ..templates import list_templates

router = APIRouter(prefix="/api", tags=["projects"])


class ProjectPayload(BaseModel):
    name: str | None = None
    slug: str | None = None
    connection_id: str
    template_id: str | None = None
    table_name: str | None = None
    schema_name: str | None = None
    response_format: str = "result.data.pagination"
    seed_count: int | None = None


class ProjectUpdatePayload(BaseModel):
    name: str | None = None
    response_format: str | None = None


class SeedPayload(BaseModel):
    count: int = Field(default=5, ge=1, le=100)


@router.get("/templates")
def get_templates() -> dict[str, Any]:
    return {"items": list_templates()}


@router.get("/formats")
def get_formats() -> dict[str, Any]:
    return {"items": format_public()}


@router.get("/projects")
def get_projects() -> dict[str, Any]:
    return {"items": list_projects_public()}


@router.post("/projects", status_code=201)
def add_project(payload: ProjectPayload) -> dict[str, Any]:
    return create_project(payload.model_dump())


@router.patch("/projects/{project_id}")
def edit_project(project_id: str, payload: ProjectUpdatePayload) -> dict[str, Any]:
    return update_project(
        project_id,
        name=payload.name,
        response_format=payload.response_format,
    )


@router.delete("/projects/{project_id}", status_code=204)
def remove_project(project_id: str) -> Response:
    delete_project(project_id)
    return Response(status_code=204)


@router.post("/projects/{project_id}/seed")
def seed_more(project_id: str, payload: SeedPayload) -> dict[str, Any]:
    return seed_project(project_id, payload.count)


@router.get("/projects/{project_id}/preview")
def preview(
    project_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=3, ge=1, le=50),
) -> dict[str, Any]:
    return preview_project(project_id, page=page, page_size=page_size)


@router.get("/projects/{project_id}/detail")
def get_project_detail(project_id: str) -> dict[str, Any]:
    project = store.get_project(project_id)
    if not project:
        from ..db.base import DBError

        raise DBError("Mock 项目不存在", kind="not_found")
    return next(
        item for item in list_projects_public() if item["id"] == project["id"]
    )
