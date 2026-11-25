# MockFast Desktop

MockFast 的 Windows 桌面壳。它把 **Electron + 内置 Python FastAPI 后端** 打包成一个安装包：用户不需要安装 Python，也不需要手动启动 `run.py`。

> 当前版本：**v0.0.2** · Windows x64 · 未签名

## 下载

从 [GitHub Releases](https://github.com/sunlanda/mock-fast-api/releases/latest) 下载：

| 文件 | 说明 |
| --- | --- |
| `MockFast-0.0.2-Setup.exe` | NSIS 安装版，可选安装目录，创建桌面/开始菜单快捷方式 |
| `MockFast-0.0.2-Portable.exe` | 便携版，双击直接运行，不写注册表 |

> Windows SmartScreen 可能提示“未知发布者”，因为目前没有代码签名证书。确认下载来源是 GitHub Release 后选择「更多信息 → 仍要运行」。

## 它怎么工作

```text
MockFast.exe (Electron)
   │
   ├─ 选择一个空闲的 127.0.0.1 端口
   ├─ 启动 resources/backend/mockfast-backend.exe
   │     └─ PyInstaller 打包的 FastAPI + Uvicorn + Web UI
   ├─ 轮询 /api/health，就绪后加载 http://127.0.0.1:<port>
   └─ 退出时通过 taskkill /T /F 结束后端进程树
```

- 后端只监听 `127.0.0.1`，不对外暴露。
- 端口是动态分配的，避免和其他本地服务冲突。
- 数据目录：`%APPDATA%\MockFast\data`
  - `app.db`：连接、项目、日志、设置
  - `demo.db`：内置 SQLite 演示库
- 后端日志：`%APPDATA%\MockFast\backend.log`
- 首次启动会自动创建「用户中心 Demo」和「商品列表 Demo」。

## 本地开发

### 环境要求

- Node.js 20+
- Python 3.10+（仅开发/打包需要，最终用户不需要）
- Windows 10/11 x64（当前发布目标）

### 1. 安装 Python 依赖

```powershell
cd ..
python -m venv .venv
.\.venv\Scripts\activate
python -m pip install -r requirements.txt pyinstaller
```

### 2. 安装桌面依赖

```powershell
cd desktop
npm install
```

如果 Electron 二进制下载失败（国内网络），可以使用镜像重新安装：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
Remove-Item node_modules\electron\dist -Recurse -Force -ErrorAction SilentlyContinue
npm install
```

或手动把官方 `electron-v45.5.0-win32-x64.zip` 解压到 `desktop\node_modules\electron\dist`，并写入 `desktop\node_modules\electron\path.txt`：

```text
electron.exe
```

### 3. 构建内置后端

```powershell
npm run build:backend
```

输出：

```text
desktop/backend/dist/mockfast-backend.exe
```

脚本会优先使用项目根目录的 `.venv\Scripts\python.exe`；也可以通过环境变量指定：

```powershell
$env:MOCKFAST_PYTHON="C:\Python312\python.exe"
npm run build:backend
```

### 4. 启动桌面开发版

```powershell
npm start
```

`npm start` 会打开 Electron 窗口，自动拉起后端，并打开 DevTools。若 `backend/dist/mockfast-backend.exe` 不存在，开发模式会退回到：

```text
<repo>\.venv\Scripts\python.exe run.py --port <随机端口>
```

### 5. 打包

```powershell
npm run dist
```

输出到 `desktop/release/`：

```text
MockFast-0.0.2-Setup.exe
MockFast-0.0.2-Portable.exe
```

只打便携版：

```powershell
npm run dist:portable
```

只生成未压缩目录（调试打包内容）：

```powershell
npm run pack
```

## 脚本一览

| 命令 | 作用 |
| --- | --- |
| `npm start` | Electron 开发模式，自动启动后端 |
| `npm run build:backend` | 用 PyInstaller 构建 `mockfast-backend.exe` |
| `npm run pack` | 生成未安装目录到 `release/win-unpacked` |
| `npm run dist` | 构建 NSIS 安装包 + 便携版 |
| `npm run dist:portable` | 只构建便携版 |

## 目录结构

```text
desktop/
├─ electron/
│  ├─ main.js          # 启动后端、创建窗口、菜单、进程清理
│  ├─ preload.js       # 最小 contextBridge
│  ├─ loading.html     # 启动等待页
│  └─ error.html       # 启动失败页（重试/打开日志/退出）
├─ scripts/
│  ├─ build_backend.py # PyInstaller 构建逻辑
│  └─ build-backend.mjs# 选择 Python 解释器并调用构建
├─ build/
│  ├─ icon.png
│  ├─ icon-512.png
│  └─ icon.ico
├─ backend/            # 构建产物（不提交）
├─ release/            # 安装包产物（不提交）
├─ electron-builder.yml
├─ package.json
└─ README.md
```

## 发布 Release

仓库根目录的 `.github/workflows/release.yml` 在推送 `v*` tag 时自动：

1. 安装 Python / Node 依赖。
2. 构建 `mockfast-backend.exe`。
3. 构建 NSIS + Portable 安装包。
4. 用 `GITHUB_TOKEN` 创建 GitHub Release 并上传 `.exe`。

发布命令：

```bash
git tag -a v0.0.2 -m "MockFast v0.0.2"
git push origin v0.0.2
```

本地手动构建不会上传；`--publish never` 是默认行为，避免误传到 GitHub。

## 测试

打包后至少验证：

- [ ] 安装版能启动，窗口先显示加载页，随后进入工作台。
- [ ] `%APPDATA%\MockFast\backend.log` 有 `Backend ready`。
- [ ] 工作台能创建模板项目并调用 `/mock/...`。
- [ ] 数据浏览器 / SQL 控制台 / 调用日志能打开。
- [ ] 关闭窗口后 `mockfast-backend.exe` 不残留（任务管理器检查）。
- [ ] 便携版在另一目录也能启动。
- [ ] 不安装 Python 的机器也能运行。

开发模式验证：

```powershell
npm start
# 另开终端
curl http://127.0.0.1:<窗口实际端口>/api/health
```

## 安全说明

- 桌面版和 Web 版都默认只监听 `127.0.0.1`。
- 远程数据库仍需在设置页显式开启；远程连接默认只读。
- 没有登录、自动更新和代码签名；不要将端口转发到公网。
- 数据库凭据保存在 `%APPDATA%\MockFast\data\app.db`，请按本机敏感文件保护。

## 已知限制

- 当前只发布 **Windows x64**；`main.js` 已为 macOS/Linux 留出后端路径分支，但尚未配置对应构建目标。
- 安装包未签名，Windows SmartScreen 会提示未知发布者。
- 暂无自动更新（auto-update）；新版本需要重新下载安装。
- 单文件 PyInstaller 后端首次启动会比后续启动稍慢。

## License

[Apache-2.0](../LICENSE)
