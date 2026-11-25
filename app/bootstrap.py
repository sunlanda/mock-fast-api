"""First-run demo bootstrap: a working SQLite connection + two mock projects."""

from __future__ import annotations

import sys
import traceback
from typing import Any

from . import services, store
from .config import DEMO_DB_PATH


def ensure_demo() -> list[dict[str, Any]]:
    store.init_db()
    if store.is_bootstrapped():
        return []
    if store.list_connections():
        # Never touch an existing workspace on upgrade.
        store.set_bootstrapped(True)
        return []
    created: list[dict[str, Any]] = []
    try:
        connection = services.create_connection(
            name="本地演示库",
            kind="sqlite",
            config={"path": str(DEMO_DB_PATH)},
            read_only=False,
        )
        specs = [
            {
                "name": "用户中心 Demo",
                "slug": "user-center",
                "connection_id": connection["id"],
                "template_id": "users",
                "table_name": "users",
                "response_format": "result.data.pagination",
                "seed_count": 26,
            },
            {
                "name": "商品列表 Demo",
                "slug": "product-catalog",
                "connection_id": connection["id"],
                "template_id": "products",
                "table_name": "products",
                "response_format": "data.data",
                "seed_count": 18,
            },
        ]
        for spec in specs:
            try:
                created.append(services.create_project(spec))
            except Exception:
                traceback.print_exc()
        store.set_bootstrapped(True)
    except Exception:
        traceback.print_exc(file=sys.stderr)
    return created
