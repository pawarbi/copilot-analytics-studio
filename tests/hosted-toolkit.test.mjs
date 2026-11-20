import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHostedToolkit, createPublishingGate } from '../lib/hosted-toolkit.mjs';
import { createSdkTools, runSdkOperation } from '../lib/sdk-operations.mjs';
import { reportId, workspaceId } from './fixtures.mjs';

const actor = { account: 'alice@contoso.com', tenantId: workspaceId, objectId: reportId };

test('hosted SDK token provider binds identity and refuses interactive or cross-tenant actions', async () => {
  const requested = [], logs = [];
  const tools = await createSdkTools({ actor, getToken: async scopes => { requested.push(scopes); return 'isolated-test-token'; }, log: value => logs.push(value) });
  const provider = tools.tokenProvider.m365TokenProvider;
  const request = { scopes: ['https://dev.teams.microsoft.com/AppDefinitions.ReadWrite'] };
  assert.equal((await provider.getAccessToken(request)).value, 'isolated-test-token');
  assert.deepEqual((await provider.getJsonObject(request)).value, { tid: workspaceId, oid: reportId, upn: actor.account, preferred_username: actor.account, unique_name: actor.account });
  assert.equal((await provider.getJsonObject(request, reportId)).isErr(), true);
  assert.equal((await provider.switchTenant(reportId)).isErr(), true);
  const status = (await provider.getStatus(request)).value;
  const { signedIn } = await import('@microsoft/teamsfx-api');
  assert.equal(status.status, signedIn);
  assert.equal((await tools.ui.confirm()).isErr(), true);
  assert.equal((await tools.ui.openUrl()).isErr(), true);
  assert.deepEqual(logs, [], 'Tokens must not be written to operation logs.');
  assert.equal(requested.length, 3);
});

test('hosted SDK dispatches chat-access removal through shareApplication, not ownership removal', async () => {
  const calls = [];
  const { ok } = await import('@microsoft/teamsfx-api');
  class FxCore {
    constructor(tools) { this.tools = tools; }
    async shareApplication(inputs) { calls.push(inputs); return ok(undefined); }
    async removeSharedAccess() { assert.fail('Ownership removal is not a chat-sharing operation.'); }
  }
  const sdk = {
    FxCore, AuthSvcScopes: () => ['https://api.spaces.skype.com/Region.ReadWrite'],
    teamsDevPortalClient: { setRegionEndpointByToken: async () => {} },
    QuestionNames: { ShareOperation: 'share-operation', ShareScope: 'scope', UserEmail: 'email' }
  };
  await runSdkOperation({ operation: 'unshare', cwd: 'isolated-workspace', emails: ['person@contoso.com'], actor, getToken: async () => 'test-token', log() {} }, sdk);
  assert.equal(calls[0]['share-operation'], 'unshare');
  assert.equal(calls[0].scope, 'users');
  assert.equal(calls[0].email, 'person@contoso.com');
  assert.equal(calls[0].env, 'dev');
  assert.equal(calls[0].nonInteractive, true);
});

test('free hosted publishing serializes SDK workers and releases capacity after failures', async () => {
  const gate = createPublishingGate();
  let release;
  const active = gate.run(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(gate.run(() => {}), /busy/);
  release(); await active;
  await assert.rejects(gate.run(() => { throw new Error('test failure'); }), /test failure/);
  assert.equal(await gate.run(() => 'available'), 'available');
});

test('real SDK initializes offline through the hosted Tools contract without authorizing a cloud action', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fida-sdk-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { FxCore } = await import('@microsoft/teamsfx-core');
  const tools = await createSdkTools({ actor, getToken: async () => { assert.fail('An incomplete project must not request cloud authorization.'); }, log() {} });
  const result = await new FxCore(tools).provisionResources({ platform: 'cli', projectPath: dir, env: 'dev', nonInteractive: true });
  assert.equal(result.isErr(), true);
  assert.equal(result.error.name, 'MissingRequiredFileError');
});

test('hosted worker receives only session tokens over IPC, strips host secrets and releases its gate on timeout', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fida-worker-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const savedSecret = process.env.FIDA_CLIENT_SECRET;
  process.env.FIDA_CLIENT_SECRET = 'fixture-host-secret';
  t.after(() => { if (savedSecret === undefined) delete process.env.FIDA_CLIENT_SECRET; else process.env.FIDA_CLIENT_SECRET = savedSecret; });
  let spawnOptions, hang = false;
  const messages = [], output = [];
  const gate = createPublishingGate();
  const identity = {
    status: () => ({ signedIn: true, account: actor.account }),
    actor: () => actor,
    token: async scopes => { assert.deepEqual(scopes, ['https://dev.teams.microsoft.com/AppDefinitions.ReadWrite']); return 'fixture-session-token'; }
  };
  const spawnWorker = (entry, args, options) => {
    spawnOptions = options;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.connected = true;
    child.kill = () => { child.connected = false; queueMicrotask(() => child.emit('close', 1)); };
    child.send = message => {
      messages.push(message);
      if (message.kind === 'run' && !hang) queueMicrotask(() => child.emit('message', { kind: 'token', id: 1, scopes: ['https://dev.teams.microsoft.com/AppDefinitions.ReadWrite'] }));
      if (message.kind === 'token-result') queueMicrotask(() => {
        child.emit('message', { kind: 'log', value: 'authorization=Bearer-private-fixture' });
        child.emit('message', { kind: 'result', code: 0 });
        child.emit('close', 0);
      });
    };
    return child;
  };
  const run = createHostedToolkit({ identity, gate, homeDir: dir, spawnWorker });
  const result = await run(['provision', '--folder', dir], { onOutput: value => output.push(value) });
  assert.equal(result.code, 0);
  assert.equal(spawnOptions.env.FIDA_CLIENT_SECRET, undefined);
  assert.equal(spawnOptions.env.HOME, dir); assert.equal(spawnOptions.env.USERPROFILE, dir);
  assert.equal(JSON.stringify(messages[0]).includes('fixture-session-token'), false);
  assert.equal(messages[1].token, 'fixture-session-token');
  assert.doesNotMatch(output.join(''), /fixture-session-token|Bearer-private-fixture|fixture-host-secret/);
  hang = true;
  assert.equal((await run(['provision', '--folder', dir], { timeoutMs: 5 })).timedOut, true);
  assert.equal(await gate.run(() => 'released'), 'released');
});
