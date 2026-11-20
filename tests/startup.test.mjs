import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientId } from './identity-fixtures.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function startEntryPoint(t, hosted) {
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [join(root, 'server.mjs')], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: String(port), FIDA_HOSTED: String(hosted),
      FIDA_PUBLIC_ORIGIN: 'https://fida.test', FIDA_CLIENT_ID: clientId,
      FIDA_CLIENT_SECRET: 'isolated-startup-test-fixture'
    }
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`FIDA startup timed out: ${output}`)), 15000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('FIDA is ready at ')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`FIDA exited before startup (${code}): ${output}`)); });
  });
  return { base: `http://127.0.0.1:${port}`, output: () => output };
}

test('real hosted entry point starts and answers Render health checks without a top-level await cycle', async t => {
  const app = await startEntryPoint(t, true);
  const response = await fetch(`${app.base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.doesNotMatch(app.output(), /unsettled top-level await|isolated-startup-test-fixture/);
});

test('real local entry point still starts and exposes its local bootstrap', async t => {
  const app = await startEntryPoint(t, false);
  const response = await fetch(`${app.base}/api/bootstrap`);
  assert.equal(response.status, 200);
  const bootstrap = await response.json();
  assert.equal(bootstrap.hosting.mode, 'local');
  assert.equal(typeof bootstrap.csrfToken, 'string');
});
