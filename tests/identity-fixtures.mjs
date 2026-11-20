import { reportId, workspaceId } from './fixtures.mjs';

export const clientId = reportId;
export function fakeMsal(config) {
  const consented = new Set();
  let lastRequest, currentAccount;
  const accountFor = name => ({
    username: `${name}@contoso.com`, tenantId: name === 'bob' ? reportId : workspaceId,
    localAccountId: name === 'bob' ? workspaceId : reportId, homeAccountId: `${name}-home`
  });
  const key = scopes => scopes.filter(scope => !['openid', 'profile', 'offline_access'].includes(scope)).sort().join(' ');
  const client = {
    allConsented: false, nonceOverride: null, wrongSilentAccount: false, requests: [], codeRequests: [],
    async getAuthCodeUrl(request) {
      lastRequest = request; client.requests.push(request);
      return `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${new URLSearchParams({ state: request.state, nonce: request.nonce })}`;
    },
    async acquireTokenByCode(request) {
      client.codeRequests.push(request);
      currentAccount = accountFor(request.code);
      consented.add(key(request.scopes));
      return {
        account: currentAccount, accessToken: 'test-access-token',
        idTokenClaims: { nonce: client.nonceOverride ?? lastRequest.nonce, aud: config.auth.clientId, tid: currentAccount.tenantId }
      };
    },
    async acquireTokenSilent(request) {
      if (!client.allConsented && !consented.has(key(request.scopes))) throw Object.assign(new Error('Consent required.'), { name: 'InteractionRequiredAuthError', errorCode: 'consent_required' });
      return { accessToken: `token-for-${currentAccount.username}`, account: client.wrongSilentAccount ? accountFor('bob') : currentAccount };
    },
    async clearCache() { currentAccount = null; consented.clear(); }
  };
  return client;
}
