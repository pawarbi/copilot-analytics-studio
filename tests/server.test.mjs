import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { testApp, validProject, titleId, sharedTitleId, reportId } from './fixtures.mjs';

const publishConfirmation = project => ({ confirmPublish: true, scope: project.deploymentScope ?? 'personal', revision: project.revision });

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
  for (const name of ['report_32_item.svg', 'semantic_model_32_item.svg', 'power_bi_32_color.svg', 'copilot_32_color.svg', 'fabric_32_color.svg']) {
    const image = await fetch(`${app.base}/icons/${name}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/svg+xml');
    assert.match(await image.text(), /<svg/);
  }
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

test('parses typed GUIDs and preserves semantic model routing through save and export', async t => {
  const app = await testApp(); t.after(app.close);
  assert.equal((await app.request('/sources/parse', { method: 'POST', body: { url: reportId } })).status, 400);
  for (const type of ['Report', 'Semantic model']) {
    const parsed = await app.json('/sources/parse', { method: 'POST', body: { url: reportId, type } });
    assert.equal(parsed.artifactId, reportId);
    assert.equal(parsed.type, type);
  }
  const project = await savedProject(app);
  project.reports[0] = { ...project.reports[0], url: reportId, type: 'Semantic model' };
  await app.json(`/projects/${project.id}`, { method: 'PUT', body: project });
  const saved = await app.json(`/projects/${project.id}`);
  assert.equal(saved.reports[0].url, reportId);
  assert.equal(saved.reports[0].type, 'Semantic model');
  const preview = await app.json(`/projects/${project.id}/files`);
  assert.equal(preview.valid, true);
  assert.ok(preview.files.find(file => file.path === 'appPackage/agent_instructions.md').content.includes(`| Semantic model | ${reportId} |`));
});

test('publishes only with confirmation, locks the active draft, preserves identities and last successful package', async t => {
  const app = await testApp(); t.after(app.close);
  let project = await savedProject(app);
  assert.equal((await app.request(`/projects/${project.id}/publish`, { method: 'POST', body: {} })).status, 400);
  let release;
  app.state.hold = new Promise(resolve => { release = resolve; });
  const job = await app.json(`/projects/${project.id}/publish`, { method: 'POST', body: publishConfirmation(project) });
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
  const failedJob = await app.json(`/projects/${project.id}/publish`, { method: 'POST', body: publishConfirmation(project) });
  assert.equal((await app.waitForJob(failedJob.id)).status, 'failed');
  assert.equal(app.state.environments[1].M365_TITLE_ID, titleId);
  assert.deepEqual(Buffer.from(await (await app.request(`/projects/${project.id}/package`)).arrayBuffer()), originalPackage);
  await assert.rejects(stat(join(app.dataDir, 'projects', project.id, 'workspace', 'appPackage', 'skills', 'sales-review')), { code: 'ENOENT' });
  assert.equal(strFromU8(unzipSync(originalPackage)['test-marker.txt']), 'Sales analyst');
});

test('keeps deployment identities, workspaces and packages separate when switching scopes', async t => {
  const app = await testApp(); t.after(app.close);
  let project = await savedProject(app);
  async function publishSaved() {
    const job = await app.json(`/projects/${project.id}/publish`, { method: 'POST', body: publishConfirmation(project) });
    const result = await app.waitForJob(job.id);
    assert.equal(result.status, 'succeeded', result.error);
    project = await app.json(`/projects/${project.id}`);
  }
  await publishSaved();
  const personal = project.deployment;
  project = await app.json(`/projects/${project.id}`, { method: 'PUT', body: { ...project, deploymentScope: 'shared' } });
  assert.equal(project.deployment, null);
  assert.equal((await app.request(`/projects/${project.id}/package`)).status, 409);
  assert.equal((await app.request(`/projects/${project.id}/publish`, { method: 'POST', body: { ...publishConfirmation(project), scope: 'personal' } })).status, 400);
  const preview = await app.json(`/projects/${project.id}/files`);
  assert.match(preview.files.find(file => file.path === 'env/.env.dev').content, /M365_TITLE_ID=\n/);
  await publishSaved();
  assert.equal(project.deployment.titleId, sharedTitleId);
  assert.notEqual(project.deployment.teamsAppId, personal.teamsAppId);
  assert.deepEqual(project.deployments.personal, personal);
  assert.equal(app.state.environments[1].AGENT_SCOPE, 'shared');
  assert.equal(app.state.environments[1].TEAMS_APP_ID, '');
  await publishSaved();
  assert.equal(app.state.environments[2].M365_TITLE_ID, sharedTitleId);
  const shared = project.deployment;
  project = await app.json(`/projects/${project.id}`, { method: 'PUT', body: { ...project, deploymentScope: 'personal' } });
  assert.deepEqual(project.deployment, personal);
  assert.deepEqual(project.deployments.shared, shared);
  await publishSaved();
  assert.equal(app.state.environments[3].M365_TITLE_ID, titleId);
  assert.equal(app.state.environments[3].AGENT_SCOPE, 'personal');
  assert.equal(app.state.calls.some(args => args[0] === 'share'), false, 'Changing modes and publishing must never grant access.');
});

test('sharing requires confirmation and a current shared deployment; grants and removes chat access without publishing', async t => {
  const app = await testApp(); t.after(app.close);
  let project = await savedProject(app);
  const path = `/projects/${project.id}/sharing`;
  const input = { confirmSharing: true, operation: 'add', emails: 'Person@contoso.com,\nteam@contoso.com,person@contoso.com', titleId: sharedTitleId };
  assert.equal((await app.request(path, { method: 'POST', body: { ...input, revision: project.revision } })).status, 409);
  project = await app.json(`/projects/${project.id}`, { method: 'PUT', body: { ...project, deploymentScope: 'shared' } });
  const published = await app.json(`/projects/${project.id}/publish`, { method: 'POST', body: publishConfirmation(project) });
  assert.equal((await app.waitForJob(published.id)).status, 'succeeded');
  project = await app.json(`/projects/${project.id}`);
  for (const override of [
    { confirmSharing: false }, { operation: 'tenant' }, { emails: '--scope tenant' },
    { emails: Array.from({ length: 21 }, (_, i) => `person${i}@contoso.com`).join(',') }
  ]) assert.equal((await app.request(path, { method: 'POST', body: { ...input, revision: project.revision, ...override } })).status, 400);
  assert.equal((await app.request(path, { method: 'POST', body: { ...input, revision: project.revision - 1 } })).status, 409);
  assert.equal((await app.request(path, { method: 'POST', body: { ...input, revision: project.revision, titleId } })).status, 409);
  assert.equal(app.state.calls.some(args => args[0] === 'share'), false);
  let release;
  app.state.hold = new Promise(resolve => { release = resolve; });
  const grant = await app.json(path, { method: 'POST', body: { ...input, revision: project.revision } });
  assert.equal((await app.request(`/projects/${project.id}`, { method: 'PUT', body: project })).status, 409);
  assert.equal((await app.request('/auth/logout', { method: 'POST', body: {} })).status, 409);
  release(); app.state.hold = null;
  assert.equal((await app.waitForJob(grant.id)).status, 'succeeded');
  project = await app.json(`/projects/${project.id}`);
  assert.deepEqual(project.deployment.sharing.recipients, ['person@contoso.com', 'team@contoso.com']);
  const workspace = join(app.dataDir, 'projects', project.id, 'workspace-shared');
  assert.deepEqual(app.state.calls.find(args => args[0] === 'share'), ['share', '--scope', 'users', '--email', 'person@contoso.com,team@contoso.com', '--env', 'dev', '--folder', workspace, '--interactive', 'false']);
  app.state.failSharing = true;
  const failed = await app.json(path, { method: 'POST', body: { ...input, operation: 'remove', emails: 'person@contoso.com', revision: project.revision } });
  const failure = await app.waitForJob(failed.id);
  assert.equal(failure.status, 'failed');
  assert.match(failure.logs.join(), /Sharing blocked by test policy/);
  assert.match(failure.error, /partially changed/);
  assert.deepEqual((await app.json(`/projects/${project.id}`)).deployment.sharing, project.deployment.sharing);
  app.state.failSharing = false;
  const remove = await app.json(path, { method: 'POST', body: { ...input, operation: 'remove', emails: 'person@contoso.com', revision: project.revision } });
  assert.equal((await app.waitForJob(remove.id)).status, 'succeeded');
  project = await app.json(`/projects/${project.id}`);
  assert.deepEqual(project.deployment.sharing.recipients, ['team@contoso.com']);
  assert.ok(app.state.calls.some(args => args[0] === 'share' && args[1] === 'remove' && args[2] === '--users'));
  const revision = project.revision;
  const update = await app.json(`/projects/${project.id}/publish`, { method: 'POST', body: publishConfirmation(project) });
  assert.equal((await app.waitForJob(update.id)).status, 'succeeded');
  project = await app.json(`/projects/${project.id}`);
  assert.ok(project.revision > revision);
  assert.deepEqual(project.deployment.sharing.recipients, ['team@contoso.com'], 'Shared publishing updates must preserve recipient tracking.');
  app.state.account = 'other@contoso.com';
  assert.equal((await app.request(path, { method: 'POST', body: { ...input, revision: project.revision } })).status, 403);
});
