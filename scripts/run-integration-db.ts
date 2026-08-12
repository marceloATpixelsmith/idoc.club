import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { validateTestDatabaseUrl } from '../lib/db/test-database-url.ts';

function run(command: string, args: string[], environment = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with status ${code ?? 'unknown'}.`)));
  });
}

async function output(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let value = '';
    child.stdout.on('data', (chunk) => { value += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(value.trim())
      : reject(new Error(`${command} exited with status ${code ?? 'unknown'}.`)));
  });
}

async function runSuite(url: string) {
  const validated = validateTestDatabaseUrl(url).toString();
  const integrationTests = (await readdir('tests'))
    .filter((name) => name.endsWith('.integration.ts'))
    .sort()
    .map((name) => `tests/${name}`);
  if (integrationTests.length === 0) throw new Error('No PostgreSQL integration tests were discovered.');
  await run(process.execPath, [
    '--import',
    'tsx',
    '--conditions=react-server',
    '--test',
    '--test-concurrency=1',
    ...integrationTests,
  ], { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: validated });
}

async function main() {
  if (process.env.TEST_DATABASE_URL) {
    await runSuite(process.env.TEST_DATABASE_URL);
    return;
  }

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const databaseName = `idoc_test_${suffix}`;
  const containerName = `idoc-test-${suffix}`;
  const password = randomUUID();
  let started = false;
  try {
    await run('docker', [
      'run', '--detach', '--name', containerName, '--publish-all',
      '--env', `POSTGRES_DB=${databaseName}`,
      '--env', 'POSTGRES_USER=idoc_test_runner',
      '--env', `POSTGRES_PASSWORD=${password}`,
      'postgres:16-alpine',
    ]);
    started = true;
    const mapping = await output('docker', ['port', containerName, '5432/tcp']);
    const port = mapping.split(':').at(-1);
    if (!port || !/^\d+$/.test(port)) throw new Error('Docker did not publish the PostgreSQL port.');
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await run('docker', ['exec', containerName, 'pg_isready', '-U', 'idoc_test_runner', '-d', databaseName]);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!ready) throw new Error('PostgreSQL did not become ready within 30 seconds.');
    const url = `postgres://idoc_test_runner:${password}@127.0.0.1:${port}/${databaseName}`;
    await runSuite(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown provisioning error';
    throw new Error(
      `Unable to provision isolated PostgreSQL. Install a running Docker engine or supply a validated TEST_DATABASE_URL. ${message}`
    );
  } finally {
    if (started) await run('docker', ['rm', '--force', containerName]).catch(() => undefined);
  }
}

await main();
