import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureEntry = join(root, 'scripts', 'editorial-browser-fixture.mjs');
const nextEntry = join(root, 'frontend', 'node_modules', 'next', 'dist', 'bin', 'next');
const children = [];
let stopping = false;

function run(command, args, options = {}) {
  return spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
}

function runOnce(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = run(command, args, options);
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`)));
  });
}

async function isReachable(url) {
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not become ready.`);
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.unref();
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 300).unref();
}

async function main() {
  await access(nextEntry);
  if (await isReachable('http://127.0.0.1:3100') || await isReachable('http://127.0.0.1:3199')) {
    throw new Error('Ports 3100 or 3199 are already in use. Close the existing local app first.');
  }

  console.log('로컬 데모를 준비합니다. 실제 SNS 또는 운영 데이터에는 연결하지 않습니다.');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await runOnce(npmCommand, ['run', 'build'], { shell: process.platform === 'win32' });

  const fixture = run(process.execPath, [fixtureEntry]);
  const frontend = run(process.execPath, [nextEntry, 'dev', '-p', '3100'], {
    cwd: join(root, 'frontend'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      APP_ORIGIN: 'http://localhost:3100',
      BACKEND_API_URL: 'http://127.0.0.1:3199/api',
      NEXT_PUBLIC_OAUTH_CALLBACK_ORIGIN: 'http://localhost:3199',
    },
  });
  children.push(fixture, frontend);

  for (const child of children) {
    child.once('error', (error) => {
      console.error(error.message);
      stop(1);
    });
    child.once('exit', (code) => {
      if (!stopping) {
        console.error(`로컬 데모 프로세스가 종료됐습니다. code=${code ?? 'unknown'}`);
        stop(code ?? 1);
      }
    });
  }

  await Promise.all([
    waitFor('http://127.0.0.1:3199'),
    waitFor('http://127.0.0.1:3100'),
  ]);
  console.log('데모가 준비됐습니다. 종료하려면 이 창에서 Ctrl+C를 누르세요.');
  if (process.env.NO_BROWSER !== '1') openBrowser('http://127.0.0.1:3199/start');
  await new Promise(() => undefined);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

main().catch((error) => {
  console.error(`시작 실패: ${error instanceof Error ? error.message : String(error)}`);
  stop(1);
});
