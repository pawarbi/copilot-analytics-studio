import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createApp } from '../server.mjs';
import { newProject, parseEnvironment } from '../lib/generator.mjs';

export const reportId = '11111111-2222-4333-8444-555555555555';
export const workspaceId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const titleId = 'U_12345678-1234-4234-8234-123456789012';
export const sharedTitleId = 'U_87654321-4321-4321-8321-210987654321';

export function validProject() {
  return {
    ...newProject(), name: 'Sales analyst', deploymentScope: 'personal',
    developer: { name: 'Contoso', website: 'https://contoso.com', privacy: 'https://contoso.com/privacy', terms: 'https://contoso.com/terms' },
    reports: [{ name: 'Sales', url: `https://app.powerbi.com/groups/${workspaceId}/reports/${reportId}/ReportSection`, description: 'Use Sales Amount for booked sales; use order dates.' }],
    skills: [{ name: 'sales-review', description: 'Use for sales rankings.', instructions: 'Prefer [Sales Amount]. Shares use all territories as the denominator.', recipes: 'EVALUATE ROW("Sales", [Sales Amount])' }]
  };
}

export function fakeToolkit({ signedIn = true } = {}) {
  const state = { signedIn, account: 'maker.name@contoso.com', calls: [], failPublish: false, failSharing: false, hold: null, environments: [] };
  const run = async (args, { onOutput = () => {} } = {}) => {
    state.calls.push(args);
    if (args[0] === 'auth') {
      if (args[1] === 'login') state.signedIn = true;
      if (args[1] === 'logout') state.signedIn = false;
      return { code: 0, stdout: state.signedIn ? `Your Microsoft 365 account is: ${state.account}.\n` : 'You are not signed in.', stderr: '' };
    }
    if (args[0] === 'share') {
      if (state.hold) await state.hold;
      onOutput(state.failSharing ? 'Sharing blocked by test policy.' : 'Test sharing change completed.');
      return { code: state.failSharing ? 1 : 0, stdout: state.failSharing ? '' : 'Test sharing change completed.', stderr: state.failSharing ? 'Sharing blocked by test policy.' : '' };
    }
    if (args[0] !== 'provision') throw new Error('Unexpected Toolkit command in test.');
    const workspace = args[args.indexOf('--folder') + 1];
    const envPath = join(workspace, 'env', '.env.dev');
    const env = parseEnvironment(await readFile(envPath, 'utf8'));
    state.environments.push(env);
    onOutput('Test-double Toolkit output; not a real cloud deployment.');
    if (state.hold) await state.hold;
    await mkdir(join(workspace, 'appPackage', 'build'), { recursive: true });
    const name = JSON.parse(await readFile(join(workspace, 'appPackage', 'declarativeAgent.json'), 'utf8')).name;
    await writeFile(join(workspace, 'appPackage', 'build', 'appPackage.dev.zip'), zipSync({ 'test-marker.txt': strToU8(name) }));
    if (state.failPublish) return { code: 1, stdout: '', stderr: 'Test failure.' };
    const shared = env.AGENT_SCOPE === 'shared';
    await writeFile(envPath, `${await readFile(envPath, 'utf8')}\nTEAMS_APP_ID=${shared ? '88888888-7777-4666-8555-444444444444' : '99999999-8888-4777-8666-555555555555'}\nM365_TITLE_ID=${shared ? sharedTitleId : titleId}\nM365_APP_ID=${shared ? 'shared-test-app' : 'personal-test-app'}\nSHARE_LINK=https://m365.cloud.microsoft/${shared ? 'apps/?templatedAppId=shared-test-app' : 'chat/'}\n`);
    return { code: 0, stdout: 'Test deployment completed.', stderr: '' };
  };
  return { state, run };
}

export async function testApp(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'copilot-studio-test-'));
  const fake = fakeToolkit(options);
  const { server } = createApp({ dataDir, toolkit: fake.run });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await fetch(`${base}/api/bootstrap`).then(r => r.json())).csrfToken;
  const request = (path, { method = 'GET', body, headers = {} } = {}) => fetch(`${base}/api${path}`, {
    method, headers: { 'X-Studio-Token': token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const json = async (path, options) => {
    const response = await request(path, options), value = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${value.error}`);
    return value;
  };
  const waitForJob = async id => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const job = await json(`/jobs/${id}`);
      if (job.status !== 'running') return job;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Test operation did not complete.');
  };
  return {
    base, dataDir, server, ...fake, request, json, waitForJob,
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}
