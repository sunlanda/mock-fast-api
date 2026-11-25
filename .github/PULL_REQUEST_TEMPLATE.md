<!--
  感谢提交 PR！请尽量完整填写，方便维护者快速理解与 review。
  Thank you for contributing! Please fill in the sections below.
-->

## 改了什么

<!-- 用一两句话描述这个 PR 的行为变化。 -->

## 为什么

<!-- 关联 Issue：Closes #123 / Fixes #456；并说明动机和场景。 -->

## 怎么测试

<!-- 写清楚复现步骤、测试数据、数据库版本；UI 改动请附截图或录屏。 -->

- [ ] 本地启动 `python run.py --port 8787` 通过
- [ ] `/api/health` 返回 200
- [ ] 相关 Mock API / SQL / 数据浏览器流程已手动验证
- [ ] `python -m compileall -q app run.py` 通过
- [ ] 前端改动已通过 `node --check`

## 截图 / 录屏

<!-- UI 改动必填；前后对比更好。 -->

## 类型

- [ ] `feat` 新功能
- [ ] `fix` Bug 修复
- [ ] `docs` 文档
- [ ] `refactor` 重构
- [ ] `test` 测试
- [ ] `chore` 构建 / CI / 依赖

## Checklist

- [ ] 没有提交 `data/app.db`、`.venv`、`.acl-reports`、密钥或真实连接串
- [ ] 没有削弱 SQL 安全守卫；如调整规则，已在描述中说明风险
- [ ] 前端对数据库返回内容做了转义
- [ ] 新增配置 / 行为 / 限制已更新 README 或相关文档
- [ ] 破坏性变更已标注 `BREAKING CHANGE`
- [ ] 一个 PR 只做一件事，规模尽量控制在 400 行以内（不含截图）
