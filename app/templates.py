"""Starter templates: schema + believable seed data + copy for the UI."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

NAMES = [
    "林晚",
    "陈予安",
    "江屿",
    "苏念",
    "周时雨",
    "许知夏",
    "顾言",
    "沈星野",
    "陆知遥",
    "宋清和",
    "程也",
    "夏栀",
    "唐棠",
    "韩叙",
    "叶澄",
    "白露",
    "温野",
    "秦桑",
    "黎川",
    "姜茶",
    "谢春山",
    "池鱼",
    "闻舟",
    "祝星",
    "简宁",
    "常青",
    "柳序",
    "何以",
    "路遥",
    "南枝",
]

BIOS = [
    "把复杂留给自己，把简单交给用户。",
    "前端工程师 / 咖啡因驱动。",
    "正在把 PRD 翻译成可点击的原型。",
    "喜欢做减法，也喜欢做动效。",
    "全栈练习生，专注体验细节。",
    "用数据讲故事的产品设计师。",
    "不写注释，但写测试。",
    "在浏览器里造小宇宙。",
]

PRODUCTS = [
    ("雾面不锈钢保温杯", "家居", 129.0, "https://picsum.photos/seed/mf-cup/640/480"),
    ("胡桃木桌面收纳架", "家居", 189.0, "https://picsum.photos/seed/mf-desk/640/480"),
    ("云感记忆棉坐垫", "家居", 99.0, "https://picsum.photos/seed/mf-cushion/640/480"),
    ("落日橘香薰蜡烛", "美妆", 79.0, "https://picsum.photos/seed/mf-candle/640/480"),
    ("轻量防泼水通勤包", "服饰", 329.0, "https://picsum.photos/seed/mf-bag/640/480"),
    ("磁吸折叠手机支架", "数码", 69.0, "https://picsum.photos/seed/mf-stand/640/480"),
    ("原色棉麻四件套", "家居", 459.0, "https://picsum.photos/seed/mf-bed/640/480"),
    ("桌面绿植小夜灯", "家居", 119.0, "https://picsum.photos/seed/mf-light/640/480"),
    ("复古机械键盘", "数码", 599.0, "https://picsum.photos/seed/mf-kb/640/480"),
    ("空气感防晒衣", "服饰", 239.0, "https://picsum.photos/seed/mf-jacket/640/480"),
    ("手冲咖啡入门套装", "户外", 299.0, "https://picsum.photos/seed/mf-coffee/640/480"),
    ("极简陶瓷餐具六件套", "家居", 199.0, "https://picsum.photos/seed/mf-plate/640/480"),
    ("折叠露营月亮椅", "户外", 249.0, "https://picsum.photos/seed/mf-chair/640/480"),
    ("降噪蓝牙耳机", "数码", 899.0, "https://picsum.photos/seed/mf-audio/640/480"),
    ("山系冲锋衣", "服饰", 699.0, "https://picsum.photos/seed/mf-coat/640/480"),
    ("氨基酸洁面慕斯", "美妆", 89.0, "https://picsum.photos/seed/mf-clean/640/480"),
    ("便携榨汁杯", "数码", 159.0, "https://picsum.photos/seed/mf-juice/640/480"),
    ("亚麻窗帘", "家居", 269.0, "https://picsum.photos/seed/mf-curtain/640/480"),
    ("运动速干T恤", "服饰", 129.0, "https://picsum.photos/seed/mf-tee/640/480"),
    ("香樟木衣柜香片", "家居", 49.0, "https://picsum.photos/seed/mf-wood/640/480"),
]

ARTICLES = [
    ("从 PRD 到可调用接口：前端的 60 分钟", "林晚", "把联调前置，先把交互跑起来。"),
    ("Mock 数据也要有尊严", "陈予安", "一套可信的假数据，胜过一次无效联调。"),
    ("分页、筛选、排序的接口设计清单", "江屿", "写给需要定接口的前端同学。"),
    ("设计稿之外的加载态", "苏念", "骨架屏不是万能药。"),
    ("如何用一个下午搭好演示环境", "周时雨", "本地优先，少依赖，快启动。"),
    ("当后端还没准备好", "许知夏", "前端可以先做什么？"),
    ("数据可视化的克制美学", "顾言", "让信息密度和呼吸感共存。"),
    ("一份给新人的 SQL 安全清单", "沈星野", "先学会不删库。"),
    ("接口响应格式的三种常见约定", "陆知遥", "result.data.pagination 还是 data.data？"),
    ("把假数据做得像真的", "宋清和", "名字、时间、状态都要有逻辑。"),
    ("前端工程师的数据库速查表", "程也", "够用就好。"),
    ("Mock Server 的边界在哪里", "夏栀", "别让它变成第二个后端。"),
]

TODOS = [
    ("对齐登录页错误码", "high"),
    ("补充订单列表空状态", "medium"),
    ("把接口响应切到 result.data.pagination", "high"),
    ("整理移动端字号规范", "low"),
    ("给表格加骨架屏", "medium"),
    ("确认导出文件的字段顺序", "high"),
    ("修复日期选择器时区问题", "high"),
    ("补充权限不足的提示文案", "medium"),
    ("把埋点接到新看板", "low"),
    ("和设计确认图标描边", "low"),
    ("联调退款流程", "high"),
    ("清理无用的 feature flag", "low"),
    ("给批量操作加二次确认", "medium"),
    ("补一版 404 插画", "low"),
    ("压测列表接口的首屏时间", "high"),
]

ORDER_STATUS = ["pending", "paid", "shipped", "completed", "refunded"]
CHANNELS = ["小程序", "官网", "APP", "抖音", "线下门店"]
TAGS = ["前端", "Mock", "接口设计", "数据库", "工程效率", "体验", "SQL", "可视化"]


def _iso(minutes_ago: int) -> str:
    moment = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return moment.replace(microsecond=0).isoformat()


def _column(
    name: str,
    type_name: str,
    *,
    primary_key: bool = False,
    auto_increment: bool = False,
    nullable: bool = True,
    default: Any = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "type": type_name,
        "primary_key": primary_key,
        "auto_increment": auto_increment,
        "nullable": nullable,
        "default": default,
    }


def _id_column() -> dict[str, Any]:
    return _column("id", "int", primary_key=True, auto_increment=True, nullable=False)


def _user_row(index: int) -> dict[str, Any]:
    name = NAMES[(index - 1) % len(NAMES)]
    roles = ["editor", "viewer", "admin", "viewer", "editor"]
    statuses = ["active", "active", "active", "invited", "disabled"]
    return {
        "id": index,
        "name": name,
        "email": f"user{index:02d}@mockfast.dev",
        "role": roles[(index - 1) % len(roles)],
        "status": statuses[(index - 1) % len(statuses)],
        "avatar": f"https://i.pravatar.cc/96?img={(index % 70) + 1}",
        "bio": BIOS[(index - 1) % len(BIOS)],
        "created_at": _iso(index * 97 + 30),
    }


def _product_row(index: int) -> dict[str, Any]:
    title, category, price, cover = PRODUCTS[(index - 1) % len(PRODUCTS)]
    return {
        "id": index,
        "title": title if index <= len(PRODUCTS) else f"{title} · {index // len(PRODUCTS) + 1}代",
        "category": category,
        "price": round(price + ((index * 17) % 60) - 20, 2),
        "stock": (index * 37) % 480 + 12,
        "rating": round(4.1 + ((index * 7) % 9) / 10, 1),
        "on_sale": index % 7 != 0,
        "cover": cover,
        "created_at": _iso(index * 211 + 90),
    }


def _order_row(index: int) -> dict[str, Any]:
    return {
        "id": index,
        "order_no": f"MF{datetime.now().year}{(120000 + index * 37):08d}",
        "customer": NAMES[(index * 3) % len(NAMES)],
        "amount": round(59 + ((index * 83) % 1900) + (index % 10) / 10, 2),
        "status": ORDER_STATUS[(index - 1) % len(ORDER_STATUS)],
        "channel": CHANNELS[(index * 2) % len(CHANNELS)],
        "paid": ORDER_STATUS[(index - 1) % len(ORDER_STATUS)] not in ("pending", "refunded"),
        "created_at": _iso(index * 173 + 15),
    }


def _article_row(index: int) -> dict[str, Any]:
    title, author, summary = ARTICLES[(index - 1) % len(ARTICLES)]
    published = index % 4 != 0
    return {
        "id": index,
        "title": title if index <= len(ARTICLES) else f"{title}（{index // len(ARTICLES) + 1}）",
        "author": author,
        "summary": summary,
        "tags": ",".join(
            [TAGS[(index - 1) % len(TAGS)], TAGS[(index * 3) % len(TAGS)]]
        ),
        "views": (index * 431) % 9000 + 120,
        "published": published,
        "published_at": _iso(index * 601 + 60) if published else None,
        "created_at": _iso(index * 601 + 120),
    }


def _todo_row(index: int) -> dict[str, Any]:
    title, priority = TODOS[(index - 1) % len(TODOS)]
    return {
        "id": index,
        "title": title if index <= len(TODOS) else f"{title} · 第 {index // len(TODOS) + 1} 轮",
        "done": index % 3 == 0,
        "priority": priority,
        "due_date": (
            datetime.now(timezone.utc) + timedelta(days=(index % 12) - 2)
        ).date().isoformat(),
        "assignee": NAMES[(index * 5) % len(NAMES)],
        "created_at": _iso(index * 43 + 8),
    }


TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "users",
        "name": "用户中心",
        "tagline": "列表 / 详情 / 增删改",
        "description": "带角色、状态与头像的用户表，最适合登录后首页、成员管理、权限弹窗等场景。",
        "table": "users",
        "icon": "users",
        "tone": "mint",
        "badge": "最常用",
        "columns": [
            _id_column(),
            _column("name", "string", nullable=False),
            _column("email", "string", nullable=False),
            _column("role", "string", nullable=False, default="viewer"),
            _column("status", "string", nullable=False, default="active"),
            _column("avatar", "string"),
            _column("bio", "text"),
            _column("created_at", "datetime", nullable=False),
        ],
        "generate": _user_row,
    },
    {
        "id": "products",
        "name": "商品列表",
        "tagline": "价格 / 库存 / 上下架",
        "description": "电商列表页的标准字段，自带价格、库存、评分与上下架状态，适合做卡片和表格。",
        "table": "products",
        "icon": "shopping",
        "tone": "amber",
        "badge": "电商",
        "columns": [
            _id_column(),
            _column("title", "string", nullable=False),
            _column("category", "string", nullable=False),
            _column("price", "decimal", nullable=False),
            _column("stock", "int", nullable=False, default=0),
            _column("rating", "decimal"),
            _column("on_sale", "bool", nullable=False, default=True),
            _column("cover", "string"),
            _column("created_at", "datetime", nullable=False),
        ],
        "generate": _product_row,
    },
    {
        "id": "orders",
        "name": "订单管理",
        "tagline": "状态机 / 金额 / 渠道",
        "description": "带订单号、支付状态与渠道的订单数据，适合做状态筛选、退款流程和统计卡片。",
        "table": "orders",
        "icon": "receipt",
        "tone": "blue",
        "badge": "状态机",
        "columns": [
            _id_column(),
            _column("order_no", "string", nullable=False),
            _column("customer", "string", nullable=False),
            _column("amount", "decimal", nullable=False),
            _column("status", "string", nullable=False),
            _column("channel", "string", nullable=False),
            _column("paid", "bool", nullable=False, default=False),
            _column("created_at", "datetime", nullable=False),
        ],
        "generate": _order_row,
    },
    {
        "id": "articles",
        "name": "文章内容",
        "tagline": "富文本 / 标签 / 发布态",
        "description": "标题、摘要、标签、浏览量、发布状态一应俱全，可用于 CMS、资讯流与后台编辑器。",
        "table": "articles",
        "icon": "file",
        "tone": "rose",
        "badge": "CMS",
        "columns": [
            _id_column(),
            _column("title", "string", nullable=False),
            _column("author", "string", nullable=False),
            _column("summary", "text"),
            _column("tags", "string"),
            _column("views", "int", default=0),
            _column("published", "bool", default=False),
            _column("published_at", "datetime"),
            _column("created_at", "datetime", nullable=False),
        ],
        "generate": _article_row,
    },
    {
        "id": "todos",
        "name": "待办清单",
        "tagline": "优先级 / 完成态 / 截止日",
        "description": "轻量的任务表，包含优先级、负责人和截止日期，适合演示拖拽、筛选和完成进度。",
        "table": "todos",
        "icon": "check",
        "tone": "violet",
        "badge": "轻量",
        "columns": [
            _id_column(),
            _column("title", "string", nullable=False),
            _column("done", "bool", nullable=False, default=False),
            _column("priority", "string", nullable=False, default="medium"),
            _column("due_date", "date"),
            _column("assignee", "string"),
            _column("created_at", "datetime", nullable=False),
        ],
        "generate": _todo_row,
    },
]

TEMPLATE_MAP = {template["id"]: template for template in TEMPLATES}


def generate_rows(template_id: str, count: int, start_index: int = 1) -> list[dict[str, Any]]:
    template = TEMPLATE_MAP[template_id]
    generator: Callable[[int], dict[str, Any]] = template["generate"]
    return [generator(index) for index in range(start_index, start_index + count)]


def template_public(template: dict[str, Any]) -> dict[str, Any]:
    generator: Callable[[int], dict[str, Any]] = template["generate"]
    preview = [generator(index) for index in range(1, 3)]
    return {
        "id": template["id"],
        "name": template["name"],
        "tagline": template["tagline"],
        "description": template["description"],
        "table": template["table"],
        "icon": template["icon"],
        "tone": template["tone"],
        "badge": template["badge"],
        "columns": template["columns"],
        "field_count": len(template["columns"]),
        "preview": preview,
    }


def list_templates() -> list[dict[str, Any]]:
    return [template_public(template) for template in TEMPLATES]
