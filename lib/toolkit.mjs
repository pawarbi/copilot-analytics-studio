import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function redact(value) {
  return String(value)
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted token]')
    .replace(/((?:access_token|refresh_token|client_secret|authorization)["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]');
}

export function createToolkitRunner() {
  return (args, { cwd = root, onOutput = () => {}, timeoutMs = 20 * 60 * 1000 } = {}) => new Promise((resolve, reject) => {
    const entry = join(root, 'node_modules', '@microsoft', 'm365agentstoolkit-cli', 'cli.js');
    const env = { ...process.env, NO_COLOR: '1', ATK_CLI_SKILL: 'true' };
    delete env.FORCE_COLOR;
    for (const key of ['M365_AGENT_ID', 'M365_TITLE_ID', 'M365_APP_ID', 'TEAMS_APP_ID', 'AGENT_SCOPE', 'TEAMSFX_ENV']) delete env[key];
    const child = spawn(process.execPath, [entry, ...args, '--telemetry', 'false'], {
      cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const consume = stream => chunk => {
      const value = redact(chunk.toString('utf8'));
      if (stream === 'stdout') stdout = (stdout + value).slice(-200000);
      else stderr = (stderr + value).slice(-200000);
      onOutput(value);
    };
    child.stdout.on('data', consume('stdout'));
    child.stderr.on('data', consume('stderr'));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, stdout, stderr, timedOut });
    });
  });
}

export function parseAccount(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  const match = /Your Microsoft 365 account is:\s*([^\s@]+@[^\s]+)\s*$/m.exec(output);
  return { signedIn: result.code === 0 && Boolean(match), account: match?.[1].replace(/\.$/, '') ?? null };
}
