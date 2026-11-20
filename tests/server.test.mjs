import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { testApp, validProject, titleId } from './fixtures.mjs';

async function savedProject(app) {
  const created = await app.json('/projects', { method: 'POST', body: {} });
  return app.json(`/projects/${created.id}`, { method: 'PUT', body: { ...validProject(), id: created.id, revision: created.revision } });
}

test('requires a local session and Microsoft sign-in; interactive login uses exact Toolkit arguments', async t => {
  const app = await testApp({ signedIn: false }); t.after(app.close);
  assert.equal((await fetch(`${app.base}/api/auth/status`)).status, 403);
  assert.equal((await app.request('/projects')).status, 401);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { tenant: 'not-a-guid' } })).status, 400);
  const job = await app.json('/auth/login', { method: 'POST', body: {} });
  const completed = await app.waitForJob(job.id);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.result.account, 'maker.name@contoso.com');
  assert.deepEqual(app.state.calls.find(args => args[1] === 'login'), ['auth', 'login', 'm365', '--interactive', 'true']);
  assert.equal((await app.request('/auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await app.request('/projects')).status, 401);
});

test('rejects foreign origins, cross-site requests and arbitrary static file reads', async t => {
  const app = await testApp(); t.after(app.close);
  assert.equal((await fetch(`${app.base}/api/bootstrap`, { headers: { Origin: 'https://foreign.test' } })).status, 403);
  assert.equal((await fetch(`${app.base}/api/bootstrap`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(`${app.base}/server.mjs`)).status, 404);
  const guide = await fetch(`${app.base}/agent-guide.js`);
  assert.equal(guide.status, 200);
  assert.match(guide.headers.get('content-type'), /javascript/);
  const html = await fetch(app.base);
  assert.match(html.headers.get('content-security-policy'), /script-src 'self' 'nonce-/);
  assert.doesNotMatch(await html.text(), /__NONCE__/);
});

test('persists drafts, prevents lost updates, and exports previewed source without auth files', async t => {
  const app = await testApp(); t.after(app.close);
  const project = await savedProject(app);
  assert.equal((await app.request(`/projects/${project.id}`, { method: 'PUT', body: { ...project, revision: 1 } })).status, 409);
  assert.equal(JSON.parse(await readFile(join(app.dataDir, 'projects', project.id, 'project.json'), 'utf8')).name, project.name);
  const preview = await app.json(`/projects/${project.id}/files`);
  assert.equal(preview.valid, true);
  const response = await app.request(`/projects/${project.id}/download`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), preview.files.map(f => f.path).sort());
  assert.ok(files['appPackage/skills/sales-review/SKILL.md']);
  assert.ok(!Object.keys(files).some(path => path.endsWith('.user')));
  assert.equal(app.state.calls.some(args => args[0] === 'provision'), false);
  assert.equal((await app.json('/projects'))[0].id, project.id);
});

test('publishes only with confirmation, locks the active draft, preserves identities and last successful package', async t => {
  const app = await testApp(); t.after(app.close);
  let project = await savedProject(app);
  assert.equal((await app.request(`/projects/${project.id}/publish`, { method: 'POST', body: {} })).status, 400);
  let release;
  app.state.hold = new Promise(resolve => { release = resolve; });
  const job = await app.json(`/projects/${project.id}/publish`, { method: 'POST', body: { confirmPersonal: true } });
  assert.equal((await app.request(`/projects/${project.id}`, { method: 'PUT', body: project })).status, 409);
  assert.equal((await app.request('/auth/logout', { method: 'POST', body: {} })).status, 409);
  release(); app.state.hold = null;
  const completed = await app.waitForJob(job.id);
  assert.equal(completed.status, 'succeeded', completed.error);
  assert.equal(completed.result.deployment.agentId, `${titleId}.analyticsAgent`);
  const originalPackage = Buffer.from(await (await app.request(`/projects/${project.id}/package`)).arrayBuffer());
  project = await app.json(`/projects/${project.id}`);
  project.skills = []; project.name = 'Updated sales analyst';
  project = await app.json(`/projects/${project.id}`, { method: 'PUT', body: project });
  app.state.failPublish = true;
  const failedJob = await app.json(`/projects/${project.id}/publish`, { method: 'POST', body: { confirmPersonal: true } });
  assert.equal((await app.waitForJob(failedJob.id)).status, 'failed');
  assert.equal(app.state.environments[1].M365_TITLE_ID, titleId);
  assert.deepEqual(Buffer.from(await (await app.request(`/projects/${project.id}/package`)).arrayBuffer()), originalPackage);
  await assert.rejects(stat(join(app.dataDir, 'projects', project.id, 'workspace', 'appPackage', 'skills', 'sales-review')), { code: 'ENOENT' });
  assert.equal(strFromU8(unzipSync(originalPackage)['test-marker.txt']), 'Sales analyst');
});
