import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function openPath(target) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.unref();
}

function validatedAppUrl(value) {
  if (!value?.trim()) return null;
  const url = new URL(value.trim());
  if (url.protocol !== 'https:') throw new Error('앱 주소는 HTTPS URL이어야 합니다.');
  return url.href;
}

async function configuredAppUrl() {
  const environmentUrl = validatedAppUrl(process.env.SNS_ADMIN_URL);
  if (environmentUrl) return environmentUrl;
  try {
    return validatedAppUrl(await readFile(join(root, 'app.url'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function runLocalDemo() {
  try {
    await Promise.all([
      access(join(root, 'node_modules')),
      access(join(root, 'frontend', 'node_modules')),
    ]);
  } catch {
    console.error('\n로컬 데모 의존성이 없습니다. 개발 담당자가 다음 명령을 한 번 실행해야 합니다.');
    console.error('  npm.cmd ci');
    console.error('  npm.cmd --prefix frontend ci\n');
    process.exitCode = 1;
    return;
  }

  await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, 'scripts', 'start-local-demo.mjs')], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', (error) => {
      console.error(`로컬 데모 시작 실패: ${error.message}`);
      process.exitCode = 1;
      resolve();
    });
    child.once('exit', (code) => {
      if (code !== 0) process.exitCode = code ?? 1;
      resolve();
    });
  });
}

async function main() {
  const appUrl = await configuredAppUrl();
  if (appUrl) {
    console.log(`운영 앱을 엽니다: ${appUrl}`);
    if (process.env.NO_BROWSER !== '1') openPath(appUrl);
    return;
  }

  console.log('\n========================================');
  console.log('  SNS 홍보 자동화');
  console.log('========================================\n');
  console.log('운영 앱 주소가 아직 설정되지 않았습니다.\n');
  console.log('[1] 안전한 로컬 데모 실행 (실제 SNS 게시 없음)');
  console.log('[2] 남은 설정 문서 열기');
  console.log('[3] 종료\n');

  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await input.question('선택: ')).trim();
  input.close();

  if (answer === '1') await runLocalDemo();
  else if (answer === '2') openPath(join(root, '남은 것.md'));
  else if (answer !== '3') {
    console.error('1, 2, 3 중 하나를 선택하세요.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`시작 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
