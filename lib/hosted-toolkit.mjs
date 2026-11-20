import { fork } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { InputError } from './generator.mjs';
import { redact } from './toolkit.mjs';

export function createPublishingGate() {
  let busy = false;
  return {
    async run(action) {
      if (busy) throw new InputError('The community publishing worker is busy. Please retry shortly.', 429);
      busy = true;
      try { return await action(); } finally { busy = false; }
    }
  };
}

export function createHostedToolkit({ identity, homeDir, gate, spawnWorker = fork }) {
  return async (args, { onOutput = () => {}, timeoutMs = 20 * 60 * 1000 } = {}) => {
    const status = identity.status();
    if (args[0] === 'auth' && args[1] === 'list') return {
      code: 0, stdout: status.signedIn ? `Your Microsoft 365 account is: ${status.account}.\n` : 'Not signed in.', stderr: ''
    };
    if (!status.signedIn) throw new InputError('Sign in before publishing.', 401);
    const operation = args[0] === 'provision' ? 'provision' : args[0] === 'share' ? args[1] === 'remove' ? 'unshare' : 'share' : null;
    const cwd = args[args.indexOf('--folder') + 1];
    if (!operation || !args.includes('--folder') || !cwd) throw new InputError('Unsupported hosted Toolkit command.');
    const emailFlag = operation === 'unshare' ? '--users' : '--email';
    const emails = args.includes(emailFlag) ? args[args.indexOf(emailFlag) + 1].split(',') : [];
    return gate.run(async () => {
      await mkdir(homeDir, { recursive: true, mode: 0o700 });
      const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, ATK_CLI_SKILL: 'true', NO_COLOR: '1' };
      for (const key of Object.keys(env)) {
        if (/^(FIDA_|RENDER_)|TOKEN|PASSWORD|SECRET/i.test(key) ||
          ['M365_ACCOUNT_NAME', 'M365_AGENT_ID', 'M365_TITLE_ID', 'M365_APP_ID', 'TEAMS_APP_ID', 'AGENT_SCOPE', 'TEAMSFX_ENV'].includes(key)) delete env[key];
      }
      return new Promise((resolve, reject) => {
        const child = spawnWorker(fileURLToPath(new URL('./sdk-worker.mjs', import.meta.url)), [], {
          cwd, env, execArgv: [], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
        let result = null, closed = false, output = '';
        const emit = value => { value = redact(value); output = (output + value).slice(-200000); onOutput(value); };
        const timer = setTimeout(() => {
          result = { code: -1, stdout: output, stderr: 'Publishing timed out. Check Copilot before retrying; partial changes may have occurred.', timedOut: true };
          child.kill();
        }, timeoutMs);
        child.stdout.on('data', chunk => emit(chunk.toString('utf8')));
        child.stderr.on('data', chunk => emit(chunk.toString('utf8')));
        child.on('message', async message => {
          if (message.kind === 'log') emit(message.value);
          if (message.kind === 'result') result = { code: message.code, stdout: output, stderr: redact(message.error ?? '') };
          if (message.kind === 'token') {
            try {
              const token = await identity.token(message.scopes);
              if (!closed && child.connected) child.send({ kind: 'token-result', id: message.id, token });
            } catch (error) {
              if (!closed && child.connected) child.send({ kind: 'token-result', id: message.id, error: `Microsoft authorization is required (${error.errorCode ?? 'token_unavailable'}). Reconfirm publishing to connect the required permission.` });
            }
          }
        });
        child.once('error', error => { closed = true; clearTimeout(timer); reject(error); });
        child.once('close', code => {
          closed = true; clearTimeout(timer);
          resolve(result ?? { code: code || 1, stdout: output, stderr: 'The publishing worker stopped. Check Copilot before retrying.' });
        });
        child.send({ kind: 'run', operation, cwd, emails, actor: identity.actor() });
      });
    });
  };
}
