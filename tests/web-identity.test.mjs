import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebIdentity, PUBLISHING_SCOPES } from '../lib/web-identity.mjs';
import { reportId, workspaceId } from './fixtures.mjs';
import { clientId, fakeMsal } from './identity-fixtures.mjs';

test('sign-in and each publishing consent exchange supply the original nonce to MSAL', async () => {
  let client;
  const identity = createWebIdentity({
    clientId, clientSecret: 'isolated-test-fixture', origin: 'https://fida.test',
    clientFactory: config => client = fakeMsal(config)
  });
  let redirect = await identity.begin();
  for (let step = 0; step <= PUBLISHING_SCOPES.length; step++) {
    const url = new URL(redirect);
    const nonce = url.searchParams.get('nonce');
    assert.ok(nonce);
    redirect = await identity.complete(new URLSearchParams({ state: url.searchParams.get('state'), code: 'alice' }));
    assert.equal(client.codeRequests[step].nonce, nonce, 'MSAL must receive the expected nonce before it validates the ID token.');
    if (step === 0) redirect = await identity.connectPublishing();
  }
  assert.equal(redirect, null);
});

test('hosted OAuth uses multitenant PKCE and rejects mismatched, replayed and expired state', async () => {
  let clock = 0, client, config;
  const identity = createWebIdentity({
    clientId, clientSecret: 'isolated-test-fixture', origin: 'https://fida.test', now: () => clock,
    clientFactory: options => { config = options; return client = fakeMsal(options); }
  });
  assert.equal(config.auth.authority, 'https://login.microsoftonline.com/organizations');
  const begin = await identity.begin();
  const state = new URL(begin).searchParams.get('state');
  assert.equal(client.requests[0].codeChallengeMethod, 'S256');
  assert.equal(client.requests[0].redirectUri, 'https://fida.test/auth/callback');
  await assert.rejects(identity.complete(new URLSearchParams({ state: 'wrong', code: 'alice' })), /does not match/);
  assert.equal(identity.status().signedIn, false);
  await identity.complete(new URLSearchParams({ state, code: 'alice' }));
  assert.equal(identity.status().account, 'alice@contoso.com');
  assert.equal(identity.status().tenantId, workspaceId, 'The authenticated tenant is not pinned to FIDA’s registration tenant.');
  await assert.rejects(identity.complete(new URLSearchParams({ state, code: 'alice' })), /expired|does not match/);
  await identity.clear();
  const expired = new URL(await identity.begin()).searchParams.get('state');
  clock += 11 * 60 * 1000;
  await assert.rejects(identity.complete(new URLSearchParams({ state: expired, code: 'alice' })), /expired/);
});

test('publishing consent is incremental and cached separately for each browser identity', async () => {
  let client;
  const identity = createWebIdentity({
    clientId, clientSecret: 'isolated-test-fixture', origin: 'https://fida.test',
    clientFactory: config => client = fakeMsal(config)
  });
  let url = await identity.begin();
  await identity.complete(new URLSearchParams({ state: new URL(url).searchParams.get('state'), code: 'alice' }));
  url = await identity.connectPublishing();
  let redirects = 0;
  while (url) {
    redirects++;
    url = await identity.complete(new URLSearchParams({ state: new URL(url).searchParams.get('state'), code: 'alice' }));
  }
  assert.equal(redirects, PUBLISHING_SCOPES.length);
  assert.equal(await identity.connectPublishing(), null);
  assert.equal(await identity.token(PUBLISHING_SCOPES[0]), 'token-for-alice@contoso.com');
  client.wrongSilentAccount = true;
  await assert.rejects(identity.token(PUBLISHING_SCOPES[0]), /unexpected publishing identity/);
  await assert.rejects(identity.token(['https://attacker.test/.default']), /unsupported/);
  await assert.rejects(identity.token(['https://management.azure.com/.default']), /unsupported/);
});

test('OAuth rejects nonce mismatches, cross-account consent and a different explicitly requested tenant', async () => {
  let client;
  const identity = createWebIdentity({
    clientId, clientSecret: 'isolated-test-fixture', origin: 'https://fida.test',
    clientFactory: config => client = fakeMsal(config)
  });
  let state = new URL(await identity.begin()).searchParams.get('state');
  client.nonceOverride = 'wrong';
  await assert.rejects(identity.complete(new URLSearchParams({ state, code: 'alice' })), /does not match/);
  assert.equal(identity.status().signedIn, false);
  client.nonceOverride = null;
  state = new URL(await identity.begin({ tenant: reportId })).searchParams.get('state');
  await assert.rejects(identity.complete(new URLSearchParams({ state, code: 'alice' })), /does not match/);
  state = new URL(await identity.begin()).searchParams.get('state');
  await identity.complete(new URLSearchParams({ state, code: 'alice' }));
  state = new URL(await identity.connectPublishing()).searchParams.get('state');
  await assert.rejects(identity.complete(new URLSearchParams({ state, code: 'bob' })), /does not match/);
  assert.equal(identity.status().account, 'alice@contoso.com');
});
