"""Generic seed-row generator for tables that did not come from a template."""

from __future__ import annotations

import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from .db.base import ColumnInfo, TableInfo
from .templates import NAMES, PRODUCTS, TODOS

WORDS = ["订单", "用户", "商品", "文章", "任务", "报表", "消息", "权限", "配置", "活动"]
STATUSES = ["active", "pending", "completed", "disabled", "draft"]
CITIES = ["上海", "杭州", "深圳", "成都", "北京", "广州", "武汉", "南京"]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _value_for(column: ColumnInfo, index: int, rng: random.Random) -> Any:
    name = column.name.lower()
    type_name = column.type.lower()
    if column.nullable and rng.random() < 0.08:
        return None
    if name in ("id", "_id") or name.endswith("_id"):
        if "int" in type_name and name == "id":
            return index
    if "email" in name:
        return f"seed-{uuid.uuid4().hex[:8]}@mockfast.dev"
    if name in ("name", "username", "nickname", "customer", "assignee", "author"):
        return NAMES[index % len(NAMES)]
    if name in ("title", "subject", "label"):
        return f"{rng.choice(WORDS)}整理 · {index:02d}"
    if name in ("status", "state"):
        return rng.choice(STATUSES)
    if name in ("priority", "level"):
        return rng.choice(["high", "medium", "low"])
    if "avatar" in name or "cover" in name or "image" in name or "url" in name:
        return f"https://picsum.photos/seed/seed-{index}/640/480"
    if "phone" in name or "mobile" in name:
        return f"138{(index * 7919) % 100000000:08d}"
    if "city" in name or "address" in name:
        return rng.choice(CITIES)
    if "tag" in name:
        return rng.choice(["前端", "Mock", "数据", "体验"])
    if "desc" in name or "bio" in name or "summary" in name or "content" in name:
        return "这是一条由 MockFast 自动生成的示例内容，用于前端联调。"
    if "bool" in type_name or name.startswith("is_") or name in ("done", "paid", "published", "enabled"):
        return rng.random() > 0.4
    if "int" in type_name or "serial" in type_name:
        return rng.randint(1, 999)
    if any(token in type_name for token in ("decimal", "numeric", "float", "double", "real")):
        return round(rng.uniform(9.9, 999.0), 2)
    if "date" in type_name and "time" not in type_name:
        return (_now() - timedelta(days=rng.randint(0, 30))).date().isoformat()
    if "time" in type_name or "date" in type_name:
        return (_now() - timedelta(minutes=rng.randint(1, 40000))).isoformat()
    if "json" in type_name:
        return {"seed": True, "index": index}
    return f"{rng.choice(WORDS)}{index:02d}"


def mock_default_value(column: ColumnInfo) -> Any:
    """A forgiving value for a missing NOT NULL field on mock POST."""
    name = column.name.lower()
    type_name = column.type.lower()
    if name.endswith("_at") or name in ("created_at", "updated_at", "published_at"):
        return _now().isoformat()
    if name.endswith("_date") or name in ("date", "birthday"):
        return _now().date().isoformat()
    if "bool" in type_name:
        return False
    if any(token in type_name for token in ("int", "serial", "bigint", "smallint")):
        return 0
    if any(token in type_name for token in ("numeric", "decimal", "real", "double", "float")):
        return 0
    if "json" in type_name:
        return "{}"
    if "date" in type_name and "time" not in type_name:
        return _now().date().isoformat()
    if "time" in type_name or "date" in type_name:
        return _now().isoformat()
    if "email" in name:
        return "mock@example.com"
    return "示例值"


def generate_generic_rows(
    info: TableInfo, count: int, start_index: int = 1
) -> list[dict[str, Any]]:
    rng = random.Random(20261125 + start_index)
    rows: list[dict[str, Any]] = []
    usable = [
        column
        for column in info.columns
        if not column.auto_increment and column.name != "_id"
    ]
    if not usable:
        return []
    for index in range(start_index, start_index + count):
        row: dict[str, Any] = {}
        for column in usable:
            value = _value_for(column, index, rng)
            if value is None and not column.nullable:
                value = "示例值"
            row[column.name] = value
            if isinstance(value, (dict, list)):
                row[column.name] = json.dumps(value, ensure_ascii=False)
        rows.append(row)
    return rows
