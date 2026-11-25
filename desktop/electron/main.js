'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const startupDir = path.join(process.env.APPDATA || process.cwd(), 'MockFast');
const startupLog = path.join(startupDir, 'startup.log');
try {
  fs.mkdirSync(startupDir, { recursive: true });
  fs.appendFileSync(
    startupLog,
    `\n[${new Date().toISOString()}] main.js loaded pid=${process.pid} electron=${process.versions.electron} packaged=${!process.defaultApp}\n`
  );
} catch {
  // Startup logging must never prevent the app from starting.
}

function trace(message) {
  try {
    fs.appendFileSync(startupLog, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // ignore
  }
}

process.on('uncaughtException', (error) => trace(`uncaught: ${error.stack || error.message}`));
process.on('unhandledRejection', (error) => trace(`unhandled rejection: ${error}`));

trace('requiring electron');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
trace('electron required');

app.setName('MockFast');
app.setAppUserModelId('com.sunlanda.mockfast');
// Avoid GPU-driver-specific startup hangs on older Windows machines and VMs.
app.disableHardwareAcceleration();

const isDev = !app.isPackaged || process.argv.includes('--dev');
const repoRoot = path.resolve(__dirname, '..', '..');
const loadingFile = path.join(__dirname, 'loading.html');
const errorFile = path.join(__dirname, 'error.html');
const preloadFile = path.join(__dirname, 'preload.js');
const iconFile = path.join(__dirname, '..', 'build', 'icon.png');
const GITHUB_URL = 'https://github.com/sunlanda/mock-fast-api';

let mainWindow = null;
let backend = null;
let backendLog = null;
let backendLogPath = null;
let backendPort = null;
let backendStarting = false;
let restarting = false;
let quitting = false;

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${timestamp()}] ${message}\n`;
  process.stdout.write(line);
  if (backendLog) backendLog.write(line);
}

function isLocalUrl(urlString) {
  try {
    const url = new URL(urlString);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function healthCheck(port) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        timeout: 1500,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

async function waitForBackend(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await healthCheck(port)) return;
    } catch {
      // Keep polling while uvicorn boots.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`后端在 ${Math.round(timeoutMs / 1000)} 秒内没有就绪`);
}

function existingFile(...parts) {
  const candidate = path.join(...parts);
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveBackend(port) {
  if (app.isPackaged) {
    const executable =
      process.platform === 'win32' ? 'mockfast-backend.exe' : 'mockfast-backend';
    const bundled = path.join(process.resourcesPath, 'backend', executable);
    if (!fs.existsSync(bundled)) {
      throw new Error(`安装包缺少后端可执行文件：${bundled}`);
    }
    return {
      command: bundled,
      args: ['--port', String(port)],
      cwd: path.dirname(bundled),
      kind: 'bundled',
    };
  }

  const built =
    process.platform === 'win32'
      ? existingFile(__dirname, '..', 'backend', 'dist', 'mockfast-backend.exe')
      : existingFile(__dirname, '..', 'backend', 'dist', 'mockfast-backend');
  if (built) {
    return {
      command: built,
      args: ['--port', String(port)],
      cwd: path.dirname(built),
      kind: 'built',
    };
  }

  const python =
    process.env.MOCKFAST_PYTHON ||
    (process.platform === 'win32'
      ? existingFile(repoRoot, '.venv', 'Scripts', 'python.exe')
      : existingFile(repoRoot, '.venv', 'bin', 'python')) ||
    (process.platform === 'win32' ? 'python' : 'python3');
  return {
    command: python,
    args: [path.join(repoRoot, 'run.py'), '--port', String(port)],
    cwd: repoRoot,
    kind: 'python',
  };
}

function stopBackend() {
  if (!backend) return;
  const child = backend;
  backend = null;
  log(`Stopping backend pid=${child.pid}`);
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch (error) {
    log(`Failed to stop backend: ${error.message}`);
  }
  if (backendLog) {
    backendLog.end();
    backendLog = null;
  }
}

function closeBackendLog() {
  if (backendLog) {
    backendLog.end();
    backendLog = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#070b10',
    title: 'MockFast',
    icon: iconFile,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          width: 1280,
          height: 820,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalUrl(url) || url.startsWith('file://')) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.loadFile(loadingFile);
  return mainWindow;
}

async function startBackend() {
  if (backendStarting) return backendPort;
  backendStarting = true;
  try {
    const port = await freePort();
    const dataDir = path.join(app.getPath('userData'), 'data');
    const runtimeTemp = path.join(app.getPath('userData'), 'tmp');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(runtimeTemp, { recursive: true });
    backendLogPath = path.join(app.getPath('userData'), 'backend.log');
    backendLog = fs.createWriteStream(backendLogPath, { flags: 'a' });
    backendLog.write(`\n\n===== ${timestamp()} starting MockFast backend =====\n`);

    const target = resolveBackend(port);
    log(`Starting backend (${target.kind}): ${target.command} ${target.args.join(' ')}`);
    log(`Data directory: ${dataDir}`);
    log(`Runtime temp: ${runtimeTemp}`);
    log(`Log file: ${backendLogPath}`);

    const child = spawn(target.command, target.args, {
      cwd: target.cwd,
      env: {
        ...process.env,
        MOCKFAST_HOST: '127.0.0.1',
        MOCKFAST_PORT: String(port),
        MOCKFAST_DATA_DIR: dataDir,
        // PyInstaller one-file extracts into TEMP. Keep it inside userData so
        // restricted/system temp ACLs cannot break startup.
        TEMP: runtimeTemp,
        TMP: runtimeTemp,
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend = child;
    backendPort = port;

    child.stdout.on('data', (chunk) => {
      if (backendLog) backendLog.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (backendLog) backendLog.write(chunk);
    });
    child.on('error', (error) => {
      log(`Backend spawn error: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      log(`Backend exited code=${code} signal=${signal}`);
      if (backend === child) backend = null;
      if (!quitting && !restarting && mainWindow && backendPort) {
        void showError(
          `本地后端进程已退出（code=${code ?? 'null'}）。请查看日志后重试。`
        );
      }
    });

    await waitForBackend(port);
    log(`Backend ready on http://127.0.0.1:${port}`);
    return port;
  } finally {
    backendStarting = false;
  }
}

async function showError(message) {
  if (!mainWindow) return;
  try {
    await mainWindow.loadFile(errorFile, {
      query: {
        message: String(message || '未知错误'),
        log: backendLogPath || '',
      },
    });
  } catch (error) {
    log(`Failed to show error page: ${error.message}`);
  }
}

async function openApp() {
  if (!mainWindow) createWindow();
  try {
    const port = await startBackend();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await mainWindow.loadURL(`http://127.0.0.1:${port}`);
    if (isDev && !mainWindow.isDestroyed()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } catch (error) {
    log(`Startup failed: ${error.stack || error.message}`);
    stopBackend();
    backendPort = null;
    closeBackendLog();
    await showError(
      `${error.message}\n\n日志：${backendLogPath || '未生成'}\n\n请确认安装包完整，或重新安装。`
    );
  }
}

async function restart() {
  if (restarting) return;
  restarting = true;
  try {
    stopBackend();
    backendPort = null;
    if (mainWindow) await mainWindow.loadFile(loadingFile);
    await openApp();
  } finally {
    restarting = false;
  }
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [{ role: 'quit', label: '退出 MockFast' }],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        ...(isDev ? [{ role: 'toggleDevTools', label: '开发者工具' }] : []),
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'GitHub 仓库',
          click: () => shell.openExternal(GITHUB_URL),
        },
        {
          label: '问题反馈',
          click: () => shell.openExternal(`${GITHUB_URL}/issues`),
        },
        {
          label: 'API 文档',
          click: () => {
            if (backendPort) {
              shell.openExternal(`http://127.0.0.1:${backendPort}/api/docs`);
            } else {
              dialog.showMessageBox(mainWindow || undefined, {
                type: 'info',
                title: 'API 文档',
                message: '本地服务还没有就绪，请稍后重试。',
                buttons: ['好的'],
              });
            }
          },
        },
        { type: 'separator' },
        {
          label: `关于 MockFast v${app.getVersion()}`,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 MockFast',
              message: `MockFast v${app.getVersion()}`,
              detail:
                '本地优先的 API Mock 工作室。\n\n' +
                '数据默认保存在本机；桌面版内置 Python 后端，无需单独安装 Python。\n\n' +
                `用户数据：${app.getPath('userData')}`,
              buttons: ['好的'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('mockfast:retry', () => {
  void restart();
});

ipcMain.on('mockfast:open-log', () => {
  if (backendLogPath && fs.existsSync(backendLogPath)) {
    void shell.openPath(backendLogPath);
  }
});

ipcMain.on('mockfast:quit', () => {
  app.quit();
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    const window = createWindow();
    try {
      const port = await startBackend();
      if (!window.isDestroyed()) {
        await window.loadURL(`http://127.0.0.1:${port}`);
        if (isDev) window.webContents.openDevTools({ mode: 'detach' });
      }
    } catch (error) {
      log(`Startup failed: ${error.stack || error.message}`);
      await showError(
        `${error.message}\n\n日志：${backendLogPath || '未生成'}\n\n请确认安装包完整，或重新安装。`
      );
    }

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        if (backendPort) {
          await mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);
        } else {
          await openApp();
        }
      }
    });
  });
}

app.on('before-quit', () => {
  quitting = true;
  stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
