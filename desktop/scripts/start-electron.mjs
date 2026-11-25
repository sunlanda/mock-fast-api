#!/usr/bin/env node
/**
 * Launch Electron with a clean environment.
 *
 * Some terminal environments export ELECTRON_RUN_AS_NODE=1 (for tooling);
 * if that leaks into the GUI launch, Electron runs as plain Node and never
 * opens a window. This wrapper removes it and starts the real desktop app.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const dev = process.argv.includes('--dev');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const args = [desktopDir];
if (dev) args.push('--dev');
args.push(...process.argv.slice(2).filter((arg) => arg !== '--dev'));

const child = spawn(electronPath, args, {
  cwd: desktopDir,
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
