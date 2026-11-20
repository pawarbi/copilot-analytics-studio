import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { InputError } from './generator.mjs';

const GUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LOGIN_SCOPES = ['openid', 'profile', 'offline_access', 'https://graph.microsoft.com/User.Read'];
export const PUBLISHING_SCOPES = [
  ['https://api.spaces.skype.com/Region.ReadWrite'],
  ['https://dev.teams.microsoft.com/AppDefinitions.ReadWrite'],
  ['https://titles.prod.mos.microsoft.com/.default']
];
const allowedResources = [
  'https://graph.microsoft.com/', 'https://api.spaces.skype.com/',
  'https://dev.teams.microsoft.com/', 'https://titles.prod.mos.microsoft.com/'
];
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createWebIdentity({ clientId, clientSecret, origin, clientFactory = config => new ConfidentialClientApplication(config), now = Date.now }) {
  if (!GUID.test(clientId ?? '') || !clientSecret) throw new Error('Hosted sign-in requires FIDA_CLIENT_ID and FIDA_CLIENT_SECRET.');
  const redirectUri = `${origin}/auth/callback`;
  const client = clientFactory({
    auth: { clientId, clientSecret, authority: 'https://login.microsoftonline.com/organizations' },
    system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback() {} } }
  });
  let account = null, pending = null, selectedTenant = null;
  const requiredScopes = new Map(PUBLISHING_SCOPES.map(scopes => [scopes.join(' '), scopes]));

  function boundedScopes(scopes) {
    const values = typeof scopes === 'string' ? [scopes] : scopes;
    if (!Array.isArray(values) || !values.length || values.length > 10 ||
      values.some(scope => typeof scope !== 'string' || scope.length > 300 ||
        !allowedResources.some(resource => scope.startsWith(resource)))) {
      throw new InputError('The hosted publisher requested an unsupported Microsoft resource.');
    }
    return [...new Set(values)].sort();
  }
  function tenantAuthority() {
    return `https://login.microsoftonline.com/${account?.tenantId ?? selectedTenant ?? 'organizations'}`;
  }
  async function begin({ tenant = '', scopes = LOGIN_SCOPES, publishing = false } = {}) {
    if (tenant && !GUID.test(tenant)) throw new InputError('Tenant ID must be a GUID, or leave it blank.');
    if (!publishing && account) throw new InputError('Sign out before changing Microsoft accounts.', 409);
    if (!publishing) selectedTenant = tenant || null;
    const verifier = randomBytes(48).toString('base64url');
    const state = randomBytes(32).toString('hex'), nonce = randomBytes(32).toString('hex');
    pending = { verifier, state, nonce, scopes, publishing, expires: now() + 10 * 60 * 1000 };
    return client.getAuthCodeUrl({
      scopes, redirectUri, authority: tenantAuthority(), state, nonce, responseMode: 'query',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
      ...(account ? { loginHint: account.username } : { prompt: 'select_account' })
    });
  }
  async function token(scopes) {
    if (!account) throw new InputError('Sign in before publishing.', 401);
    scopes = boundedScopes(scopes);
    requiredScopes.set(scopes.join(' '), scopes);
    const result = await client.acquireTokenSilent({ account, scopes, authority: tenantAuthority() });
    if (!result?.accessToken || result.account?.homeAccountId !== account.homeAccountId ||
      result.account?.tenantId !== account.tenantId) throw new InputError('Microsoft returned an unexpected publishing identity.', 401);
    return result.accessToken;
  }
  async function connectPublishing() {
    if (!account) throw new InputError('Sign in before connecting publishing.', 401);
    for (const scopes of requiredScopes.values()) {
      try { await token(scopes); }
      catch (error) {
        if (error.name === 'InteractionRequiredAuthError' ||
          /consent_required|interaction_required|login_required|no_tokens_found/.test(error.errorCode ?? '')) {
          return begin({ scopes: ['openid', 'profile', 'offline_access', ...scopes], publishing: true });
        }
        throw error;
      }
    }
    return null;
  }
  async function complete(params) {
    const request = pending;
    if (!request || request.expires <= now() || !equal(request.state, params.get('state'))) {
      throw new InputError('This sign-in attempt expired or does not match your browser session.');
    }
    pending = null;
    if (params.get('error') || !params.get('code')) throw new InputError('Microsoft sign-in was cancelled or not permitted.');
    const result = await client.acquireTokenByCode({
      code: params.get('code'), codeVerifier: request.verifier, nonce: request.nonce, redirectUri, scopes: request.scopes,
      authority: tenantAuthority()
    });
    const next = result?.account, claims = result?.idTokenClaims;
    if (!next?.username || !GUID.test(next.tenantId ?? '') || !next.homeAccountId ||
      !equal(claims?.nonce, request.nonce) || claims?.aud !== clientId || claims?.tid !== next.tenantId ||
      (selectedTenant && next.tenantId !== selectedTenant) ||
      (account && (account.homeAccountId !== next.homeAccountId || account.tenantId !== next.tenantId))) {
      throw new InputError('The Microsoft sign-in response does not match this session.');
    }
    account = next;
    return request.publishing ? connectPublishing() : null;
  }
  return {
    begin, complete, token, connectPublishing,
    status: () => ({ signedIn: Boolean(account), account: account?.username ?? null, tenantId: account?.tenantId ?? null }),
    actor: () => ({ account: account?.username, tenantId: account?.tenantId, objectId: account?.localAccountId }),
    async clear() { account = null; pending = null; await client.clearCache(); }
  };
}
