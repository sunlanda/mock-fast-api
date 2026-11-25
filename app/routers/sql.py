"""SQL console and MongoDB document query endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from ..services import analyze, execute_mongo, execute_sql

router = APIRouter(prefix="/api", tags=["query"])


class SqlPayload(BaseModel):
    sql: str
    allow_ddl: bool = False
    ddl_token: str | None = None
    max_rows: int = 200


class AnalyzePayload(BaseModel):
    sql: str
    connection_id: str | None = None
    allow_ddl: bool = False


@router.post("/sql/analyze")
def analyze_sql_endpoint(payload: AnalyzePayload) -> dict[str, Any]:
    return analyze(payload.connection_id, payload.sql, payload.allow_ddl)


@router.post("/connections/{connection_id}/query")
def run_sql(connection_id: str, payload: SqlPayload) -> dict[str, Any]:
    return execute_sql(
        connection_id,
        payload.sql,
        allow_ddl=payload.allow_ddl,
        ddl_token=payload.ddl_token,
        max_rows=payload.max_rows,
    )


@router.post("/connections/{connection_id}/mongo/query")
def run_mongo(
    connection_id: str,
    payload: dict[str, Any],
    schema: str | None = Query(default=None),
) -> dict[str, Any]:
    return execute_mongo(connection_id, payload, schema)
