"""MockFast application entrypoint."""

from __future__ import annotations

import mimetypes
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, store
from .bootstrap import ensure_demo
from .config import BASE_DIR, HOST, PORT
from .db.base import DBError
from .middleware import MockCorsMiddleware, RequestLogMiddleware
from .routers import connections, logs, mock, projects, schema, sql, system

WEB_DIR = BASE_DIR / "web"

STATUS_BY_KIND = {
    "not_found": 404,
    "policy_error": 403,
    "read_only": 403,
    "blocked": 400,
    "conflict": 409,
    "config_error": 400,
    "connection_error": 502,
    "unsupported": 400,
    "sql_error": 400,
    "write_error": 400,
    "ddl_error": 400,
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.init_db()
    try:
        ensure_demo()
    except Exception:
        traceback.print_exc()
    yield


mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

app = FastAPI(
    title="MockFast",
    description="Local-first API mock studio with database introspection and a guarded SQL console.",
    version=__version__,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

app.add_middleware(MockCorsMiddleware)
app.add_middleware(RequestLogMiddleware)

app.include_router(system.router)
app.include_router(connections.router)
app.include_router(schema.router)
app.include_router(projects.router)
app.include_router(sql.router)
app.include_router(logs.router)
app.include_router(mock.router)


@app.exception_handler(DBError)
async def db_error_handler(_request: Request, exc: DBError) -> JSONResponse:
    detail = {"message": exc.message, "kind": exc.kind}
    if exc.detail:
        if isinstance(exc.detail, dict):
            detail.update(exc.detail)
        else:
            detail["info"] = exc.detail
    return JSONResponse(
        status_code=STATUS_BY_KIND.get(exc.kind, 400),
        content={"detail": detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "message": "请求参数校验失败",
                "kind": "validation_error",
                "errors": jsonable_encoder(exc.errors()),
            }
        },
    )


@app.get("/favicon.svg", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(WEB_DIR / "favicon.svg")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/assets", StaticFiles(directory=str(WEB_DIR)), name="assets")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app", host=HOST, port=PORT, reload=False, log_level="info"
    )
