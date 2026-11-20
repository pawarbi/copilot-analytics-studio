export async function createSdkTools({ actor, getToken, log }) {
  const { ok, err, BasicLogin, signedIn } = await import('@microsoft/teamsfx-api');
  const failure = message => Object.assign(new Error(message), { source: 'FIDA', name: 'HostedInteractionRequired' });
  const claims = { tid: actor.tenantId, oid: actor.objectId, upn: actor.account, preferred_username: actor.account, unique_name: actor.account };
  class SessionTokens extends BasicLogin {
    async getAccessToken(request) {
      try { return ok(await getToken(request.scopes)); }
      catch (error) { return err(failure(error.message)); }
    }
    async getJsonObject(request, tenantId) {
      if (tenantId && tenantId !== actor.tenantId) return err(failure('Changing tenants requires a new sign-in.'));
      const token = await this.getAccessToken(request);
      return token.isErr() ? token : ok(claims);
    }
    async getStatus(request) {
      const token = await this.getAccessToken(request);
      return token.isErr() ? token : ok({ status: signedIn, token: token.value, accountInfo: claims });
    }
    async signout() { throw failure('Sign out through the FIDA website.'); }
    async switchTenant(tenantId) { return tenantId === actor.tenantId ? ok(tenantId) : err(failure('Changing tenants requires a new sign-in.')); }
  }
  const logger = message => log(Array.isArray(message) ? message.map(part => part.content).join('') : String(message ?? ''));
  const unsupported = async () => err(failure('This operation requires interactive input. Download the source ZIP and use the local edition.'));
  return {
    tokenProvider: {
      m365TokenProvider: new SessionTokens(),
      azureAccountProvider: { setSubscription: async () => {}, getAccessToken: unsupported, getJsonObject: unsupported, getStatus: unsupported }
    },
    logProvider: {
      log: (level, message) => logger(message), info: logger, warning: logger, error: logger,
      debug() {}, verbose() {}, logInFile: async () => {}, getLogFilePath: () => ''
    },
    telemetryReporter: {
      sendTelemetryEvent() {}, sendTelemetryErrorEvent() {}, sendTelemetryException() {},
      getCommonProperties: () => ({}), setCommonProperty() {}
    },
    ui: {
      selectOption: unsupported, selectOptions: unsupported, inputText: unsupported, selectFile: unsupported,
      selectFiles: unsupported, selectFolder: unsupported, confirm: unsupported, openUrl: unsupported,
      showMessage: async (level, message) => { logger(message); return ok(undefined); },
      createProgressBar: () => ({ start: async () => {}, next: async message => logger(message), end: async () => {} })
    }
  };
}

export async function runSdkOperation({ operation, cwd, emails, actor, getToken, log }, sdkModule) {
  if (!['provision', 'share', 'unshare'].includes(operation)) throw new Error('Unsupported hosted publishing operation.');
  if (operation !== 'provision' && (!Array.isArray(emails) || emails.length < 1 || emails.length > 20)) throw new Error('Provide 1 to 20 recipients.');
  const sdk = sdkModule ?? await import('@microsoft/teamsfx-core');
  const { Platform } = await import('@microsoft/teamsfx-api');
  const tools = await createSdkTools({ actor, getToken, log });
  const core = new sdk.FxCore(tools);
  const inputs = { platform: Platform.CLI, projectPath: cwd, env: 'dev', nonInteractive: true, 'ignore-env-info': false };
  let result;
  const regionToken = await tools.tokenProvider.m365TokenProvider.getAccessToken({ scopes: sdk.AuthSvcScopes() });
  if (regionToken.isErr()) throw regionToken.error;
  await sdk.teamsDevPortalClient.setRegionEndpointByToken(regionToken.value);
  if (operation === 'provision') result = await core.provisionResources(inputs);
  else {
    inputs[sdk.QuestionNames.ShareOperation] = operation;
    inputs[sdk.QuestionNames.ShareScope] = 'users';
    inputs[sdk.QuestionNames.UserEmail] = emails.join(',');
    result = await core.shareApplication(inputs);
  }
  if (result.isErr()) throw result.error;
}
