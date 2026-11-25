"""Read-only SQL safety guard.

The SQL console is meant for confident frontend folks, not for dropping the
company database on a Friday afternoon. Dangerous statements are rejected
before they ever reach a driver, and schema changes require an explicit opt-in
that is checked again on the server.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

BLOCKED_RULES: list[tuple[str, str]] = [
    (r"\bDROP\s+(DATABASE|SCHEMA|USER|ROLE|OWNED|POLICY)\b", "禁止删除数据库/模式/用户等对象"),
    (r"\bDROP\s+TABLE\b", "禁止 DROP TABLE（表结构销毁无法撤销）"),
    (r"\bDROP\s+COLUMN\b", "禁止删除字段"),
    (r"\bTRUNCATE\b", "禁止 TRUNCATE（请使用带 WHERE 的 DELETE）"),
    (r"\bALTER\s+SYSTEM\b", "禁止修改数据库系统配置"),
    (r"\b(GRANT|REVOKE)\b", "禁止修改数据库权限"),
    (r"\bCREATE\s+(USER|ROLE)\b", "禁止创建数据库用户/角色"),
    (r"\bCOPY\b[\s\S]*\bFROM\s+PROGRAM\b", "禁止通过 COPY 执行系统命令"),
    (r"\bLOAD\s+DATA\b", "禁止 LOAD DATA"),
    (r"\bINTO\s+(OUTFILE|DUMPFILE)\b", "禁止导出到服务器文件"),
    (r"\bxp_cmdshell\b", "禁止执行系统命令"),
    (r"\bpg_terminate_backend\b", "禁止终止数据库会话"),
    (r"\bATTACH\s+DATABASE\b", "禁止附加外部数据库"),
    (r"\bDETACH\s+DATABASE\b", "禁止分离数据库"),
    (r"\bVACUUM\s+INTO\b", "禁止 VACUUM INTO 导出文件"),
    (r"\bCALL\b", "禁止执行存储过程（可能产生不可预期的写入）"),
    (r"\bEXEC(UTE)?\b", "禁止执行动态 SQL / 存储过程"),
    (r"\bMERGE\b", "禁止 MERGE（请拆分为明确的 UPDATE / INSERT）"),
    (r"\bPRAGMA\s+\w+\s*=", "禁止修改 SQLite PRAGMA 配置"),
    (r"\bCOPY\b", "禁止 COPY（可能读写服务器文件）"),
    (r"\b(load_extension|pg_read_file|pg_ls_dir|lo_import|lo_export)\b", "禁止调用服务器文件相关函数"),
    (r"\bCREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|EXTENSION)\b", "禁止创建函数/存储过程/触发器/扩展"),
    (r"\bALTER\s+TABLE\b[\s\S]*\b(DROP|DISABLE|DETACH)\b", "禁止通过 ALTER TABLE 删除或禁用对象"),
]

DDL_RE = re.compile(
    r"^\s*(CREATE|ALTER|RENAME|COMMENT\s+ON|ADD\s+COLUMN|DROP)\b", re.IGNORECASE
)
WRITE_RE = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|"
    r"REVOKE|VACUUM|ATTACH|DETACH)\b",
    re.IGNORECASE,
)
READ_RE = re.compile(r"^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN|PRAGMA|VALUES)\b", re.IGNORECASE)


@dataclass
class GuardResult:
    allowed: bool
    classification: str = "read"
    reasons: list[str] = field(default_factory=list)
    statements: list[str] = field(default_factory=list)
    requires_ddl: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "classification": self.classification,
            "reasons": self.reasons,
            "statement_count": len(self.statements),
            "requires_ddl": self.requires_ddl,
        }


def split_sql(text: str) -> list[str]:
    """Split on semicolons while respecting quotes, comments and dollar quotes."""
    statements: list[str] = []
    buffer: list[str] = []
    index = 0
    length = len(text)
    quote: str | None = None
    dollar_tag: str | None = None
    line_comment = False
    block_comment = False
    while index < length:
        char = text[index]
        nxt = text[index + 1] if index + 1 < length else ""
        if line_comment:
            buffer.append(char)
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            buffer.append(char)
            if char == "*" and nxt == "/":
                buffer.append(nxt)
                index += 2
                block_comment = False
            else:
                index += 1
            continue
        if dollar_tag:
            if text.startswith(dollar_tag, index):
                buffer.append(dollar_tag)
                index += len(dollar_tag)
                dollar_tag = None
                continue
            buffer.append(char)
            index += 1
            continue
        if quote:
            buffer.append(char)
            if char == quote:
                if nxt == quote:
                    buffer.append(nxt)
                    index += 2
                    continue
                quote = None
            elif char == "\\" and nxt:
                buffer.append(nxt)
                index += 2
                continue
            index += 1
            continue
        if char == "-" and nxt == "-":
            buffer.extend([char, nxt])
            index += 2
            line_comment = True
            continue
        if char == "/" and nxt == "*":
            buffer.extend([char, nxt])
            index += 2
            block_comment = True
            continue
        if char in ("'", '"', "`"):
            quote = char
            buffer.append(char)
            index += 1
            continue
        if char == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", text[index:])
            if match:
                dollar_tag = match.group(0)
                buffer.append(dollar_tag)
                index += len(dollar_tag)
                continue
        if char == ";":
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
            index += 1
            continue
        buffer.append(char)
        index += 1
    final = "".join(buffer).strip()
    if final:
        statements.append(final)
    return statements


def _without_noise(sql: str) -> str:
    sql = re.sub(r"/\*[\s\S]*?\*/", " ", sql)
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"'(?:''|\\.|[^'])*'", "''", sql)
    sql = re.sub(r'"(?:""|\\.|[^"])*"', '""', sql)
    return sql


def _snippet(sql: str, limit: int = 90) -> str:
    clean = re.sub(r"\s+", " ", sql).strip()
    return clean[:limit] + ("…" if len(clean) > limit else "")


def analyze_sql(
    sql: str,
    *,
    allow_ddl: bool = False,
    read_only: bool = False,
) -> GuardResult:
    statements = split_sql(sql)
    reasons: list[str] = []
    requires_ddl = False
    classifications: list[str] = []
    if not statements:
        return GuardResult(False, "none", ["SQL 不能为空"], [])
    if len(statements) > 8:
        return GuardResult(False, "none", ["一次最多执行 8 条语句"], statements)

    for statement in statements:
        noise = _without_noise(statement).strip()
        upper = noise.upper()
        classification = "read"
        if WRITE_RE.search(noise) or re.search(
            r"\b(INSERT|UPDATE|DELETE|REPLACE|MERGE)\b", noise, re.IGNORECASE
        ):
            classification = "write"
        if DDL_RE.search(noise) or re.search(
            r"\b(CREATE|ALTER|RENAME|DROP)\b", noise, re.IGNORECASE
        ):
            classification = "ddl"
            requires_ddl = True
        if READ_RE.search(noise) and classification == "read":
            classification = "read"
        classifications.append(classification)

        for pattern, message in BLOCKED_RULES:
            if re.search(pattern, noise, re.IGNORECASE):
                reasons.append(f"{message} · {_snippet(statement)}")

        has_update = re.search(r"\bUPDATE\b", upper)
        has_delete = re.search(r"\bDELETE\b", upper)
        if has_update:
            if not re.search(r"\bWHERE\b", upper):
                reasons.append(f"UPDATE 必须带 WHERE 条件 · {_snippet(statement)}")
            elif re.search(r"\bWHERE\s+(1\s*=\s*1|TRUE)\b", upper):
                reasons.append(f"WHERE 1=1 / TRUE 等同于全表更新，已拦截 · {_snippet(statement)}")
        if has_delete:
            if not re.search(r"\bWHERE\b", upper):
                reasons.append(f"DELETE 必须带 WHERE 条件 · {_snippet(statement)}")
            elif re.search(r"\bWHERE\s+(1\s*=\s*1|TRUE)\b", upper):
                reasons.append(f"WHERE 1=1 / TRUE 等同于清空表，已拦截 · {_snippet(statement)}")

        if classification == "ddl" and not allow_ddl:
            reasons.append(
                "结构变更（DDL）默认关闭：请打开「允许结构变更」开关并二次确认 · "
                f"{_snippet(statement)}"
            )
        if read_only and classification != "read":
            reasons.append("当前连接为只读模式，只允许 SELECT / SHOW / EXPLAIN")

    # Deduplicate while keeping order.
    seen: set[str] = set()
    unique_reasons = []
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            unique_reasons.append(reason)

    classification = "read"
    if "ddl" in classifications:
        classification = "ddl"
    elif "write" in classifications:
        classification = "write"
    return GuardResult(
        allowed=not unique_reasons,
        classification=classification,
        reasons=unique_reasons,
        statements=statements,
        requires_ddl=requires_ddl,
    )
