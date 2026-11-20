import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { createHostedApp } from '../lib/hosted-server.mjs';
import { createWebIdentity } from '../lib/web-identity.mjs';
import { fakeToolkit, validProject } from './fixtures.mjs';
import { fakeMsal, clientId } from './identity-fixtures.mjs';

async function hostedFixture(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fida-hosted-test-'));
  let clock = Date.now();
  const clients = [], toolkits = [];
  const app = await createHostedApp({
    origin: 'https://fida.test', dataDir, clientId, clientSecret: 'isolated-test-fixture',
    now: () => clock,
    identityFactory: config => createWebIdentity({
      ...config, now: () => clock,
      clientFactory: config => { const client = fakeMsal(config); clients.push(client); return client; }
    }),
    toolkitFactory: ({ identity }) => {
      const fake = fakeToolkit(); toolkits.push(fake);
      return (args, settings) => {
        fake.state.signedIn = identity.status().signedIn;
        fake.state.account = identity.status().account;
        return fake.run(args, settings);
      };
    },
    ...options
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (path, { method = 'GET', body, token, cookie, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, {
      method,
      headers: {
        Host: 'fida.test', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Studio-Token': token } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, String(value)]))
      })));
    });
    req.once('error', reject);
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
  async function session() {
    const response = await request('/api/bootstrap');
    const cookie = response.headers.get('set-cookie').split(';')[0], bootstrap = await response.json();
    const settings = { cookie, token: bootstrap.csrfToken };
    const call = (path, options = {}) => request(path, { ...settings, ...options });
    const json = async (path, options) => {
      const response = await call(path, options), value = await response.json();
      assert.equal(response.status < 400, true, value.error);
      return value;
    };
    async function signIn(name) {
      const login = await json('/api/auth/login', { method: 'POST', body: {} });
      const query = new URLSearchParams({ state: new URL(login.redirect).searchParams.get('state'), code: name });
      assert.equal((await call(`/auth/callback?${query}`)).status, 303);
    }
    return { ...settings, call, json, signIn };
  }
  return {
    ...app, clients, toolkits, request, session,
    advance: ms => { clock += ms; },
    async close() {
      await new Promise(resolve => app.server.close(resolve));
      await app.dispose();
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

test('hosted sessions isolate accounts, CSRF, drafts and source backups while allowing public landing links', async t => {
  const app = await hostedFixture(); t.after(app.close);
  assert.equal((await app.request('/healthz', { headers: { Host: 'internal-health' } })).status, 200);
  assert.equal((await app.request('/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200);
  assert.equal((await app.request('/api/bootstrap', { headers: { Origin: 'https://attacker.test' } })).status, 403);
  const alice = await app.session(), bob = await app.session();
  assert.notEqual(alice.cookie, bob.cookie); assert.notEqual(alice.token, bob.token);
  assert.equal((await alice.call('/api/projects')).status, 401);
  await alice.signIn('alice'); await bob.signIn('bob');
  assert.equal((await alice.json('/api/auth/status')).account, 'alice@contoso.com');
  assert.equal((await bob.json('/api/auth/status')).account, 'bob@contoso.com');
  const project = await alice.json('/api/projects', { method: 'POST', body: {} });
  assert.equal(project.deploymentScope, null);
  assert.equal((await bob.call(`/api/projects/${project.id}`)).status, 404);
  assert.equal((await bob.call('/api/projects', { token: alice.token })).status, 403);
  assert.equal((await alice.call('/api/projects', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.deepEqual(await bob.json('/api/projects'), []);
  const draftResponse = await alice.call(`/api/projects/${project.id}/draft`);
  assert.equal(draftResponse.status, 200, 'Incomplete drafts can be downloaded without publisher details or a deployment choice.');
  const backup = JSON.parse(strFromU8(unzipSync(new Uint8Array(await draftResponse.arrayBuffer()))['fida-project.json']));
  assert.equal(backup.project.deploymentScope, null);
  assert.equal(backup.project.id, undefined); assert.equal(backup.project.deployments, undefined);
  backup.project.id = project.id;
  backup.project.deployments = { personal: { agentId: project.id, account: 'alice@contoso.com' } };
  backup.project.deployment = backup.project.deployments.personal;
  const restored = await bob.json('/api/projects', { method: 'POST', body: { draft: backup } });
  assert.notEqual(restored.id, project.id);
  assert.deepEqual(restored.deployments, {}); assert.equal(restored.deployment, null);
  assert.equal((await bob.call('/api/projects', { method: 'POST', body: { draft: { ...backup, version: 2 } } })).status, 400);
});

test('hosted publishing connects downstream permissions before creating any cloud job and still needs reconfirmation', async t => {
  const app = await hostedFixture(); t.after(app.close);
  const user = await app.session(); await user.signIn('alice');
  let project = await user.json('/api/projects', { method: 'POST', body: {} });
  project = await user.json(`/api/projects/${project.id}`, { method: 'PUT', body: { ...validProject(), revision: project.revision } });
  assert.equal((await user.call(`/api/projects/${project.id}/installable`)).status, 200);
  assert.equal(app.clients[0].requests.length, 1, 'Manual package export must not request publishing consent.');
  const confirmation = { method: 'POST', body: { confirmPublish: true, scope: 'personal', revision: project.revision } };
  let { redirect } = await user.json(`/api/projects/${project.id}/publish`, confirmation);
  assert.ok(redirect);
  assert.equal(app.toolkits[0].state.calls.some(args => args[0] === 'provision'), false);
  let count = 0;
  while (redirect && new URL(redirect).host === 'login.microsoftonline.com') {
    count++;
    const query = new URLSearchParams({ state: new URL(redirect).searchParams.get('state'), code: 'alice' });
    const response = await user.call(`/auth/callback?${query}`);
    redirect = response.headers.get('location');
    assert.ok(count <= 3, 'Consent must terminate after the bounded downstream resources.');
  }
  assert.equal(app.toolkits[0].state.calls.some(args => args[0] === 'provision'), false);
  const job = await user.json(`/api/projects/${project.id}/publish`, confirmation);
  for (let i = 0; i < 100; i++) {
    const current = await user.json(`/api/jobs/${job.id}`);
    if (current.status !== 'running') { assert.equal(current.status, 'succeeded', current.error); return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Publishing test double did not complete.');
});

test('temporary sessions expire, sign-out removes local files, and expired cookies cannot recover previous drafts', async t => {
  const app = await hostedFixture(); t.after(app.close);
  const user = await app.session(); await user.signIn('alice');
  const project = await user.json('/api/projects', { method: 'POST', body: {} });
  app.advance(31 * 60 * 1000);
  await app.prune();
  assert.equal((await user.call(`/api/projects/${project.id}`)).status, 401);
  const fresh = await app.session(); await fresh.signIn('alice');
  assert.deepEqual(await fresh.json('/api/projects'), []);
  assert.equal((await fresh.call('/api/auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await fresh.call('/api/projects')).status, 401);
  assert.deepEqual(await readdir(app.dataDir), []);
});

test('free hosted capacity is bounded and bootstrap cookies are protected', async t => {
  const app = await hostedFixture({ maxSessions: 1 }); t.after(app.close);
  const response = await app.request('/api/bootstrap');
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-fida=/); assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  assert.equal((await app.request('/api/bootstrap')).status, 429);
  assert.equal((await app.request('/api/auth/status', { headers: { Host: 'unknown.test' } })).status, 403);
});

test('hosted project limits cannot be bypassed by concurrent draft creation', async t => {
  const app = await hostedFixture(); t.after(app.close);
  const user = await app.session(); await user.signIn('alice');
  for (let i = 0; i < 9; i++) await user.json('/api/projects', { method: 'POST', body: {} });
  const responses = await Promise.all(Array.from({ length: 5 }, () => user.call('/api/projects', { method: 'POST', body: {} })));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(responses.every(response => [201, 409, 429].includes(response.status)), true);
  assert.equal((await user.json('/api/projects')).length, 10);
  assert.equal((await user.call('/api/projects', { method: 'POST', body: {} })).status, 429);
});
