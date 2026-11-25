# 贡献指南 · Contributing to MockFast

感谢你愿意改进 MockFast。无论是修一个错别字、补一段文档、报一个 Bug，还是提交一个新功能，都是很有价值的贡献。

> 请注意：MockFast 是本地开发工具，不是生产级数据平台。涉及数据库写操作、SQL 守卫、远程访问策略的改动会按更高标准 review。

---

## 目录

- [可以贡献什么](#可以贡献什么)
- [开始之前](#开始之前)
- [本地开发环境](#本地开发环境)
- [分支规范](#分支规范)
- [Commit 规范](#commit-规范)
- [代码约定](#代码约定)
- [提交前自测](#提交前自测)
- [PR 流程](#pr-流程)
- [PR 模板](#pr-模板)
- [Review 标准](#review-标准)
- [安全与敏感信息](#安全与敏感信息)
- [发布流程](#发布流程)

---

## 可以贡献什么

- 🐛 **Bug 修复**：连接、schema 浏览、SQL 执行、日志、前端交互等。
- ✨ **功能**：新的数据库适配器、模板、响应格式、日志筛选、主题等。
- 📝 **文档**：README、教程、截图、常见问题、英文翻译。
- 🧪 **测试**：补充 smoke test、边界用例、数据库兼容性验证。
- 🎨 **体验**：可访问性、移动端布局、错误提示、空状态。
- 🔌 **集成**：与其他 Mock / API 工具、CI、编辑器的集成建议。

如果你不确定某个想法是否合适，先开一个 **Feature Request Issue**，说明使用场景，再动手。

---

## 开始之前

1. 搜索现有 [Issues](https://github.com/sunlanda/mock-fast-api/issues)，避免重复。
2. 小改动（错别字、单行修复）可以直接提 PR。
3. 大改动（新数据库、接口协议变化、SQL 守卫策略调整）请先开 Issue 对齐方案。
4. 不要提交任何真实数据库密码、`.env`、`data/app.db`、`.venv` 或 `.acl-reports`。

---

## 本地开发环境

```bash
git clone git@github.com:sunlanda/mock-fast-api.git
cd mock-fast-api

python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
python run.py --reload
```

访问：

- UI：<http://127.0.0.1:8787>
- OpenAPI：<http://127.0.0.1:8787/api/docs>

前端没有构建步骤，直接修改 `web/` 下的 HTML / CSS / ES Modules，刷新页面即可。

### 目录速览

| 路径 | 内容 |
| --- | --- |
| `app/main.py` | FastAPI 入口、静态资源、异常处理 |
| `app/db/` | SQLite / PostgreSQL / MySQL / MongoDB 适配器 |
| `app/routers/` | HTTP 路由 |
| `app/services.py` | 连接、项目、种子、SQL 执行 |
| `app/security.py` | SQL 安全守卫 |
| `web/js/` | 原生 ES Modules 前端 |
| `data/` | 运行时数据，**不要提交** |

---

## 分支规范

从最新的 `main` 切出短生命周期分支：

| 类型 | 命名示例 |
| --- | --- |
| 新功能 | `feat/custom-response-format` |
| Bug 修复 | `fix/postgres-schema-percent` |
| 文档 | `docs/quickstart` |
| 重构 | `refactor/sql-guard` |
| 杂项 | `chore/ci-node-check` |

不要直接在 `main` 上提交。一个 PR 只做一件事；如果同时包含重构和行为变更，尽量拆开。

---

## Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>(<scope>): <summary>
```

常用类型：

| type | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档 |
| `refactor` | 不改变行为的重构 |
| `test` | 测试 |
| `chore` | 构建、CI、依赖、杂项 |
| `perf` | 性能优化 |
| `style` | 格式化（不影响逻辑） |

推荐 scope：

```text
api, web, db, postgres, mysql, mongo, sql, logs, mock, docs, ci
```

示例：

```text
feat(api): add data.list response envelope
fix(postgres): pass no params for literal percent queries
docs(readme): add 5-minute quickstart
refactor(web): extract code editor component
```

要求：

- 标题使用祈使句、简短明确，不超过 72 个字符。
- 一个 commit 只做一件事；不要把无关格式化混进功能提交。
- 破坏性变更使用 `feat!:` 或在正文写 `BREAKING CHANGE:`。

---

## 代码约定

### Python

- 目标 Python 3.10+，使用类型标注。
- 保持 FastAPI 路由薄，业务逻辑放 `services.py`，数据库细节放适配器。
- 数据库异常统一转成 `DBError`，不要把驱动异常直接漏成 500。
- 新数据库适配器必须实现 `BaseAdapter` 的契约，并处理只读模式。
- 不引入重型依赖；能用标准库或现有依赖解决就不要新增包。

### 前端

- 原生 ES Modules，不引入打包器。
- 所有来自数据库 / API 的文本必须经过 `esc()` 或安全 DOM API，禁止直接 `innerHTML` 拼接未转义数据。
- 保持深色 / 浅色主题变量一致。
- 新增交互要有空状态、加载态和错误提示。
- 移动端至少保证 430px 宽度不横向溢出。

### SQL 安全守卫

- 不削弱已有拦截规则；如果确实需要放宽，必须在 PR 中说明风险并提供测试。
- 规则改动至少补充：
  - 应拦截的 SQL 示例；
  - 应放行的 SQL 示例；
  - 对多层 CTE / 多语句的影响说明。
- 前端不能作为唯一防线，服务端必须再次校验。

### API 兼容

- 已有 `/mock/{slug}` 响应结构应保持稳定；新增字段优先，不要随意删除。
- 修改默认响应格式需在 PR 中标注为行为变更。
- 数据库驱动的方言差异要写进 README 或代码注释。

---

## 提交前自测

### 1. Python 编译

```bash
python -m compileall -q app run.py
```

### 2. 前端 JS 语法

```bash
cd web
find js -name '*.js' -print0 | xargs -0 -n1 node --check
```

Windows PowerShell：

```powershell
Get-ChildItem web\js -Recurse -Filter *.js |
  ForEach-Object { node --check $_.FullName }
```

### 3. 启动 + API smoke

```bash
python run.py --port 8787
```

另开终端：

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS "http://127.0.0.1:8787/mock/user-center?page=1&pageSize=2"
curl -fsS http://127.0.0.1:8787/api/logs/stats
```

### 4. 手动验收清单

根据改动范围选择：

- [ ] 工作台能正常打开，模板卡片可生成接口。
- [ ] Mock 列表分页、详情、新增、更新、删除正常。
- [ ] 数据浏览器能切换 schema / 表，字段与数据正常显示。
- [ ] SQL 控制台正常执行 SELECT；高危 SQL 被拦截；DDL 需要二次确认。
- [ ] 调用日志能看到耗时、请求头、响应预览。
- [ ] 深色 / 浅色主题正常。
- [ ] 430px 移动端无横向滚动。
- [ ] 修改的数据库适配器（如涉及）已在目标数据库版本上验证，并记录版本号。

### 5. 不要提交

```text
data/app.db
data/demo.db
data/*.sqlite
.venv/
.acl-reports/
.tmp/
__pycache__/
```

这些都已写入 `.gitignore`。提交前用 `git status` 再检查一遍。

---

## PR 流程

1. **Fork** 仓库（或从主仓库切分支，如果维护者给了权限）。
2. 从最新 `main` 切分支。
3. 完成修改，按规范提交。
4. 推送分支。
5. 创建 Pull Request，目标分支 `main`。
6. 填写 PR 模板，附上自测结果和截图（UI 改动必须）。
7. 等待 CI 通过和至少一位维护者 review。
8. 维护者使用 **Squash merge** 合并；合并后删除分支。

### PR 标题

```text
<type>(<scope>): <summary>
```

示例：

```text
feat(api): support custom response templates
fix(postgres): avoid empty parameter list for literal percent
docs(readme): add beginner walkthrough
```

### PR 大小

- 尽量控制在 **400 行以内**（不含截图 / 生成文件）。
- 大改动拆成多个 PR，按依赖顺序合并。
- 纯格式化改动单独提交，避免掩盖逻辑 diff。

### 需要标注的变更

- **Breaking change**：接口结构、默认行为、配置项。
- **数据库兼容性**：目标版本、未测试版本。
- **安全相关**：SQL 守卫规则、远程访问策略、凭据处理。
- **UI 截图**：前后对比图更佳。

---

## PR 模板

仓库已提供 [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)。至少包含：

```markdown
## 改了什么

## 为什么

## 怎么测试

## 截图 / 录屏（UI 改动）

## Checklist
- [ ] 本地编译通过
- [ ] 相关 smoke test 通过
- [ ] 没有提交敏感信息
- [ ] 文档已更新
```

---

## Review 标准

维护者会重点检查：

- **正确性**：边界条件、数据库方言、只读模式、空数据。
- **安全性**：SQL 守卫是否被绕过；前端是否转义；凭据是否泄漏。
- **兼容性**：旧项目、旧响应格式是否仍可用。
- **可维护性**：是否复用了现有抽象；是否引入了不必要的依赖。
- **文档**：新增配置、行为、限制是否写进 README。
- **测试**：是否有可复现的验证步骤。

Review 意见会尽量给出具体修改建议。作者修改后 push 到同一分支即可自动更新 PR。

---

## 安全与敏感信息

- 不要在 Issue / PR / 截图中放真实密码、Token、生产连接串。
- 不要提交 `data/app.db`（包含本机连接密码）和日志数据。
- 如果发现安全漏洞，请不要公开开 Issue 贴利用细节；先通过仓库维护者可见的私密渠道联系。
- MockFast 没有登录和权限系统；任何“暴露到公网”的部署方式都不在本项目的安全承诺内。

---

## 发布流程

维护者发布新版本时：

1. 更新 `app/__init__.py` / 页面中的版本号（如涉及）。
2. 确认 `README.md` 的功能、限制、截图与代码一致。
3. 确认 CI 通过。
4. 在 GitHub 创建 Release，写清新增、修复、破坏性变更。
5. 合并到 `main`，保持 `main` 可运行。

---

<p align="center">
  <sub>Thank you for making MockFast better.</sub>
</p>
