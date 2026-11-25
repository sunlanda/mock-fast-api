#!/usr/bin/env node
/**
 * Pick a Python interpreter that has PyInstaller, then build the backend.
 * Works on Windows (uses .venv\Scripts\python.exe) and CI (uses python on PATH).
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const script = path.join(__dirname, 'build_backend.py');

const candidates = [
  process.env.MOCKFAST_PYTHON,
  path.join(root, '.venv', 'Scripts', 'python.exe'),
  path.join(root, '.venv', 'bin', 'python'),
  'python',
  'python3',
].filter(Boolean);

function hasPyInstaller(python) {
  const result = spawnSync(python, ['-c', 'import PyInstaller'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0;
}

let python = null;
for (const candidate of candidates) {
  if (candidate.includes(path.sep) || candidate.includes('/')) {
    if (!existsSync(candidate)) continue;
  }
  if (hasPyInstaller(candidate)) {
    python = candidate;
    break;
  }
}

if (!python) {
  console.error('[build-backend] No Python with PyInstaller found.');
  console.error('  python -m pip install pyinstaller');
  console.error('  or set MOCKFAST_PYTHON to the interpreter path.');
  process.exit(1);
}

console.log(`[build-backend] Using Python: ${python}`);
const result = spawnSync(python, [script], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: false,
});
process.exit(result.status ?? 1);
