import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rename, stat, rm, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { InputError, newProject, normalizeProject, parsePowerBiUrl, validateProject, generateFiles, parseEnvironment } from './lib/generator.mjs';
import { createToolkitRunner, parseAccount, redact } from './lib/toolkit.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 512 * 1024;
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/catalog.js': ['catalog.js', 'text/javascript; charset=utf-8'], '/agent-guide.js': ['agent-guide.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  ...Object.fromEntries(['report_32_item.svg', 'semantic_model_32_item.svg', 'power_bi_32_color.svg', 'copilot_32_color.svg', 'fabric_32_color.svg'].map(name => [`/icons/${name}`, [join('icons', name), 'image/svg+xml']]))
};

export function createApp({ dataDir = join(ROOT, 'data'), toolkit = createToolkitRunner(), origin = null, hosting = { mode: 'local' } } = {}) {
  const csrfToken = randomBytes(32).toString('hex');
  const jobs = new Map(), pendingWrites = new Set();
  let activeJob = null, signingOut = false, accountCache = null, accountPromise = null, creatingProject = false;
  const projectsDir = join(dataDir, 'projects');
  const projectPath = id => {
    if (!UUID.test(id)) throw new InputError('Invalid project identifier.');
    return join(projectsDir, id);
  };
  async function loadProject(id) {
    try { return JSON.parse(await readFile(join(projectPath(id), 'project.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new InputError('Project not found.', 404); throw error; }
  }
  async function storeProject(project) {
    const dir = projectPath(project.id);
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `project.${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(project, null, 2));
    await rename(temp, join(dir, 'project.json'));
  }
  async function checkUnchanged(project) {
    const saved = await loadProject(project.id);
    if (pendingWrites.has(project.id) || saved.revision !== project.revision) throw new InputError('The saved project changed. Reload before confirming this operation.', 409);
  }
  async function lockedProject(id, action) {
    if (pendingWrites.has(id) || (activeJob && jobs.get(activeJob)?.projectId === id)) throw new InputError('This project is busy. Wait for the current operation.', 409);
    pendingWrites.add(id);
    try { return await action(); } finally { pendingWrites.delete(id); }
  }
  async function accountStatus(force = false) {
    if (!force && accountCache && Date.now() - accountCache.time < 10000) return accountCache.value;
    if (!accountPromise) accountPromise = (async () => {
      const result = await toolkit(['auth', 'list', 'm365', '--interactive', 'false'], { timeoutMs: 30000 });
      if (result.code !== 0) throw new InputError(redact(result.stderr || result.stdout || 'Could not check the Toolkit account.'), 502);
      const value = parseAccount(result);
      accountCache = { time: Date.now(), value };
      return value;
    })().finally(() => { accountPromise = null; });
    return accountPromise;
  }
  function startJob(kind, projectId, run) {
    if (activeJob || signingOut) throw new InputError('Another sign-in, publishing or sharing operation is running.', 409);
    const job = { id: randomUUID(), kind, projectId, status: 'running', startedAt: new Date().toISOString(), logs: [], result: null, error: null };
    jobs.set(job.id, job); activeJob = job.id;
    while (jobs.size > (hosting.ephemeral ? 5 : 30)) jobs.delete(jobs.keys().next().value);
    const log = message => {
      for (const line of redact(message).split(/\r?\n/).filter(Boolean)) job.logs.push(line.slice(0, 4000));
      job.logs = job.logs.slice(hosting.ephemeral ? -150 : -600);
    };
    Promise.resolve().then(() => run(log)).then(result => { job.result = result; job.status = 'succeeded'; }).catch(error => {
      job.error = redact(error.message); job.status = 'failed'; log(job.error);
    }).finally(() => { job.finishedAt = new Date().toISOString(); activeJob = null; });
    return job;
  }
  function workspacePath(id, scope = 'personal') {
    if (!['personal', 'shared'].includes(scope)) throw new InputError('Invalid deployment scope.');
    return join(projectPath(id), scope === 'personal' ? 'workspace' : 'workspace-shared');
  }
  async function existingEnv(id, scope = 'personal') {
    if (scope === null) return {};
    try {
      const env = parseEnvironment(await readFile(join(workspacePath(id, scope), 'env', '.env.dev'), 'utf8'));
      if (env.AGENT_SCOPE && env.AGENT_SCOPE !== scope) throw new InputError('Workspace scope does not match the selected deployment.', 409);
      return env;
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; return {}; }
  }
  async function writeWorkspace(project) {
    const scope = project.deploymentScope ?? 'personal';
    const workspace = workspacePath(project.id, scope);
    const files = generateFiles(project, await existingEnv(project.id, scope));
    const skillsDir = join(workspace, 'appPackage', 'skills');
    let oldSkills = [];
    try { oldSkills = await readdir(skillsDir, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of oldSkills) {
      if (entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) && !project.skills.some(s => s.name === entry.name)) {
        await rm(join(skillsDir, entry.name), { recursive: true, force: true });
      }
    }
    for (const skill of project.skills.filter(s => !s.recipes.trim())) {
      await rm(join(skillsDir, skill.name, 'references', 'dax-recipes.md'), { force: true });
    }
    for (const [name, value] of Object.entries(files)) {
      const destination = join(workspace, ...name.split('/'));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, value);
    }
    return workspace;
  }
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json.', 415);
    let bytes = 0, chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY) throw new InputError('Request is too large.', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { throw new InputError('Request body must be valid JSON.'); }
  }

  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    const allowedHosts = origin ? [new URL(origin).host] : [`127.0.0.1:${port}`, `localhost:${port}`];
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      if (!allowedHosts.includes(req.headers.host)) throw new InputError('Unrecognized host.', 403);
      if (req.headers.origin && !(origin ? [origin] : allowedHosts.map(h => `http://${h}`)).includes(req.headers.origin)) throw new InputError('Cross-origin requests are not allowed.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site' && (!origin || req.url.startsWith('/api/'))) throw new InputError('Cross-site requests are not allowed.', 403);
      const url = new URL(req.url, origin ?? `http://${req.headers.host}`);
      if (staticFiles[url.pathname] && req.method === 'GET') {
        const [file, type] = staticFiles[url.pathname];
        let content = await readFile(join(ROOT, 'public', file));
        const nonce = randomBytes(18).toString('base64');
        if (file === 'index.html') content = Buffer.from(content.toString('utf8').replaceAll('__NONCE__', nonce));
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
        res.writeHead(200, { 'Content-Type': type }); return res.end(content);
      }
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') return json(res, 200, { csrfToken, publishingScopes: ['personal', 'shared'], hosting });
      if (!url.pathname.startsWith('/api/')) throw new InputError('Not found.', 404);
      if (req.headers['x-studio-token'] !== csrfToken) throw new InputError('Reload the application to establish a local session.', 403);
      if (url.pathname === '/api/auth/status' && req.method === 'GET') return json(res, 200, await accountStatus());
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        const input = await body(req);
        const tenant = input.tenant ?? '';
        if (typeof tenant !== 'string' || (tenant && !UUID.test(tenant))) throw new InputError('Tenant ID must be a GUID, or leave it blank.');
        return json(res, 202, startJob('login', null, async log => {
          log('Opening Microsoft 365 interactive sign-in. Complete authentication in the Microsoft browser window.');
          const args = ['auth', 'login', 'm365', '--interactive', 'true', ...(tenant ? ['--tenant', tenant] : [])];
          const result = await toolkit(args, { onOutput: log, timeoutMs: 10 * 60 * 1000 });
          accountCache = null;
          if (result.code !== 0) throw new Error(result.timedOut ? 'Sign-in timed out. Try again.' : 'Microsoft 365 sign-in did not complete. See the log.');
          const status = await accountStatus(true);
          if (!status.signedIn) throw new Error('Toolkit did not report a signed-in Microsoft 365 account.');
          return status;
        }));
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        await body(req);
        if (activeJob || signingOut) throw new InputError('Wait for the current operation before signing out.', 409);
        signingOut = true;
        try {
          const result = await toolkit(['auth', 'logout', 'm365', '--interactive', 'false'], { timeoutMs: 30000 });
          await accountPromise;
          accountCache = null;
          if (result.code !== 0) throw new InputError('Toolkit sign-out failed.', 502);
        } finally { signingOut = false; }
        return json(res, 200, { signedIn: false, account: null });
      }
      const jobMatch = /^\/api\/jobs\/([0-9a-f-]+)$/.exec(url.pathname);
      if (jobMatch && req.method === 'GET') {
        const job = jobs.get(jobMatch[1]);
        if (!job) throw new InputError('Operation not found.', 404);
        return json(res, 200, job);
      }
      if (!(await accountStatus()).signedIn) throw new InputError('Sign in to Microsoft 365 first.', 401);
      if (url.pathname === '/api/sources/parse' && req.method === 'POST') {
        const source = await body(req);
        return json(res, 200, parsePowerBiUrl(source.url, source.type));
      }
      if (url.pathname === '/api/projects' && req.method === 'GET') {
        await mkdir(projectsDir, { recursive: true });
        const ids = (await readdir(projectsDir, { withFileTypes: true })).filter(d => d.isDirectory() && UUID.test(d.name)).map(d => d.name);
        const projects = await Promise.all(ids.map(loadProject));
        return json(res, 200, projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, name, description, updatedAt, reports, skills, deployment }) => ({ id, name, description, updatedAt, reportCount: reports.length, skillCount: skills.length, deployment })));
      }
      if (url.pathname === '/api/projects' && req.method === 'POST') {
        const input = await body(req);
        if (hosting.ephemeral && creatingProject) throw new InputError('Wait for your current project to finish creating.', 409);
        if (hosting.ephemeral) creatingProject = true;
        try {
          if (hosting.ephemeral) {
            await mkdir(projectsDir, { recursive: true });
            if ((await readdir(projectsDir)).length >= 10) throw new InputError('This temporary session has reached its 10-project limit. Download your draft ZIPs and start a new session.', 429);
          }
          let project = newProject();
          if (input.draft !== undefined) {
            if (input.draft?.format !== 'fida-project' || input.draft?.version !== 1) throw new InputError('Import a FIDA draft JSON file from a downloaded draft ZIP.');
            project = normalizeProject(input.draft.project, project);
          }
          await storeProject(project);
          return json(res, 201, project);
        } finally { creatingProject = false; }
      }
      const match = /^\/api\/projects\/([0-9a-f-]+)(?:\/(files|check|download|draft|package|publish|sharing))?$/.exec(url.pathname);
      if (!match) throw new InputError('Not found.', 404);
      const [, id, action] = match;
      if (!action && req.method === 'GET') return json(res, 200, await loadProject(id));
      if (!action && req.method === 'PUT') {
        const input = await body(req);
        return await lockedProject(id, async () => {
          const previous = await loadProject(id);
          if (input.revision !== previous.revision) throw new InputError('This draft changed in another window. Reload it before saving.', 409);
          const project = normalizeProject(input, previous);
          project.revision++; project.updatedAt = new Date().toISOString();
          await storeProject(project); return json(res, 200, project);
        });
      }
      const project = await loadProject(id);
      if (action === 'draft' && req.method === 'GET') {
        const { name, description, version, instructions, developer, reports, skills, deploymentScope } = project;
        const draft = { format: 'fida-project', version: 1, project: { name, description, version, instructions, developer, reports, skills, deploymentScope } };
        const zip = zipSync({
          'fida-project.json': strToU8(JSON.stringify(draft, null, 2)),
          'README.txt': strToU8('FIDA draft backup. Extract this ZIP, then choose Import draft in FIDA and select fida-project.json.\nRestoring creates a new draft, not a connection to an existing published agent. Published agents are not deleted when temporary drafts expire.\nTo preserve an existing deployment workspace for local updates, also export its source ZIP after publishing.\nhttps://github.com/pawarbi/copilot-analytics-studio\n')
        });
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="fida-draft.zip"' }); return res.end(zip);
      }
      if (action === 'check' && req.method === 'GET') return json(res, 200, validateProject(project, { publish: true }));
      if (action === 'files' && req.method === 'GET') {
        const check = validateProject(project);
        if (!check.valid) return json(res, 200, { ...check, files: [] });
        const files = generateFiles(project, await existingEnv(id, project.deploymentScope));
        return json(res, 200, { ...check, files: Object.entries(files).map(([path, value]) => ({ path, binary: typeof value !== 'string', content: typeof value === 'string' ? value : `[Generated PNG icon, ${value.length} bytes]` })) });
      }
      if (action === 'download' && req.method === 'GET') {
        const files = generateFiles(project, await existingEnv(id, project.deploymentScope));
        const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])));
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="analytics-agent-source.zip"' }); return res.end(zip);
      }
      if (action === 'package' && req.method === 'GET') {
        if (!project.deployment) throw new InputError('Publish this agent before downloading its provisioned app package.', 409);
        if (!UUID.test(project.deployment.packageId ?? '')) throw new InputError('The published app package is not available.', 404);
        const path = join(projectPath(id), 'published', `${project.deployment.packageId}.zip`);
        try { await stat(path); } catch { throw new InputError('The provisioned app package is not available.', 404); }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="analytics-agent-app.zip"' }); return res.end(await readFile(path));
      }
      if (action === 'publish' && req.method === 'POST') {
        const input = await body(req);
        const scope = project.deploymentScope ?? 'personal';
        if (!(input.confirmPublish === true && input.scope === scope && input.revision === project.revision)) throw new InputError('Confirm publishing for the saved deployment mode and revision.');
        const check = validateProject(project, { publish: true });
        if (!check.valid) throw new InputError(check.errors.join(' '));
        if (pendingWrites.has(id)) throw new InputError('Wait for the draft to finish saving.', 409);
        const account = await accountStatus(true);
        if (!account.signedIn) throw new InputError('Sign in to Microsoft 365 first.', 401);
        if (project.deployment?.account && project.deployment.account.toLowerCase() !== account.account.toLowerCase()) throw new InputError('Sign in with the account that published this deployment.', 403);
        await checkUnchanged(project);
        return json(res, 202, startJob('publish', id, async log => {
          log(`Publishing "${project.name}" for the currently signed-in Microsoft 365 account. Scope: ${scope}.`);
          const workspace = await writeWorkspace(project);
          log('Generated manifests, instructions, skill files and project source.');
          log(`Running Microsoft Toolkit provisioning, official package validation and ${scope} Copilot deployment.`);
          const result = await toolkit(['provision', '--env', 'dev', '--folder', workspace, '--interactive', 'false'], { cwd: workspace, onOutput: log });
          if (result.code !== 0) throw new Error(result.timedOut ? 'Publishing timed out. Inspect the Toolkit log and deployment state before retrying.' : 'Microsoft Toolkit could not complete publishing. Inspect the log; provisioned identities are preserved for retries.');
          const environment = await existingEnv(id, scope);
          if (!environment.M365_TITLE_ID) throw new Error('Toolkit finished without a Copilot Title ID. Deployment could not be confirmed.');
          const packageId = randomUUID();
          const publishedDir = join(projectPath(id), 'published');
          await mkdir(publishedDir, { recursive: true });
          await copyFile(join(workspace, 'appPackage', 'build', 'appPackage.dev.zip'), join(publishedDir, `${packageId}.zip`));
          const deployment = {
            titleId: environment.M365_TITLE_ID,
            agentId: `${environment.M365_TITLE_ID}.analyticsAgent`,
            teamsAppId: environment.TEAMS_APP_ID,
            publishedAt: new Date().toISOString(), version: project.version,
            shareLink: safeCopilotLink(environment.SHARE_LINK, scope === 'shared' ? null : undefined),
            scope, packageId, account: account.account,
            sharing: project.deployment?.sharing ?? { recipients: [], updatedAt: null }
          };
          project.deployments = { ...project.deployments, [scope]: deployment };
          project.deployment = deployment; project.revision++; project.updatedAt = deployment.publishedAt;
          await storeProject(project);
          log(`Published agent identity: ${deployment.agentId}`);
          log(`${scope === 'shared' ? 'Shareable' : 'Personal'} provisioning completed. Copilot availability can take time to propagate.`);
          if (scope === 'shared') log('Grant access separately using Manage sharing. Shareable publishing is not organization-wide catalog deployment.');
          return { deployment };
        }));
      }
      if (action === 'sharing' && req.method === 'POST') {
        const input = await body(req), deployment = project.deployment;
        if (input.confirmSharing !== true) throw new InputError('Confirm the sharing change.');
        if (!['add', 'remove'].includes(input.operation)) throw new InputError('Choose Add access or Remove access.');
        if (project.deploymentScope !== 'shared' || deployment?.scope !== 'shared') throw new InputError('Publish a shareable deployment before managing access.', 409);
        if (input.titleId !== deployment.titleId || input.revision !== project.revision) throw new InputError('The deployment changed. Reload before managing sharing.', 409);
        if (pendingWrites.has(id)) throw new InputError('Wait for the draft to finish saving.', 409);
        if (typeof input.emails !== 'string' || input.emails.length > 6000) throw new InputError('Enter up to 20 user or group email addresses.');
        const recipients = [...new Set(input.emails.split(/[,;\r\n]+/).map(email => email.trim().toLowerCase()).filter(Boolean))];
        if (!recipients.length || recipients.length > 20 || recipients.some(email => email.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email))) throw new InputError('Enter 1 to 20 valid user or group email addresses, separated by commas or new lines.');
        const account = await accountStatus(true);
        if (!account.signedIn) throw new InputError('Sign in to Microsoft 365 first.', 401);
        if (!deployment.account || deployment.account.toLowerCase() !== account.account.toLowerCase()) throw new InputError('Sign in with the account that published this deployment.', 403);
        await checkUnchanged(project);
        return json(res, 202, startJob(input.operation === 'add' ? 'share' : 'unshare', id, async log => {
          const workspace = workspacePath(id, 'shared');
          const environment = await existingEnv(id, 'shared');
          if (environment.M365_TITLE_ID !== deployment.titleId || environment.TEAMS_APP_ID !== deployment.teamsAppId) throw new Error('The saved workspace does not match the published deployment. Publish an update before changing access.');
          const args = input.operation === 'add'
            ? ['share', '--scope', 'users', '--email', recipients.join(',')]
            : ['share', 'remove', '--users', recipients.join(',')];
          log(`${input.operation === 'add' ? 'Granting' : 'Removing'} chat access for ${recipients.length} recipient(s). This does not change Power BI permissions or grant edit ownership.`);
          const result = await toolkit([...args, '--env', 'dev', '--folder', workspace, '--interactive', 'false'], { cwd: workspace, onOutput: log });
          if (result.code !== 0) throw new Error(result.timedOut
            ? 'Sharing timed out. The service may have applied changes; check access before retrying.'
            : 'Toolkit could not confirm the sharing change. Check the log and tenant policies; access may have partially changed.');
          const known = new Set(deployment.sharing?.recipients ?? []);
          for (const recipient of recipients) {
            if (input.operation === 'add') known.add(recipient);
            else known.delete(recipient);
          }
          deployment.sharing = { recipients: [...known].sort(), updatedAt: new Date().toISOString() };
          project.deployments = { ...project.deployments, shared: deployment };
          project.revision++; project.updatedAt = deployment.sharing.updatedAt;
          await storeProject(project);
          log('Toolkit confirmed the sharing change. Recipients still need their own Power BI access and applicable licenses.');
          return { deployment };
        }));
      }
      throw new InputError('Method not allowed.', 405);
    } catch (error) {
      if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : 'The local operation failed. Check the server terminal.' });
      else res.end();
      if (!error.status) console.error(redact(error.stack));
    }
  });
  server.requestTimeout = 30000;
  return { server, accountStatus, dataDir, csrfToken, isBusy: () => Boolean(activeJob || signingOut || pendingWrites.size), invalidateAccount: () => { accountCache = null; } };
}

function safeCopilotLink(value, fallback = 'https://m365.cloud.microsoft/chat/') {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        ['m365.cloud.microsoft', 'copilot.cloud.microsoft', 'www.microsoft365.com', 'm365.cloud.microsoft.com', 'www.office.com'].includes(url.hostname)) return url.href;
  } catch {}
  return fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const hosted = process.env.FIDA_HOSTED === 'true';
  const app = hosted ? await (await import('./lib/hosted-server.mjs')).createHostedApp({
    origin: process.env.FIDA_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL,
    clientId: process.env.FIDA_CLIENT_ID, clientSecret: process.env.FIDA_CLIENT_SECRET
  }) : createApp();
  const { server } = app;
  server.listen(port, hosted ? '0.0.0.0' : '127.0.0.1', () => console.log(`FIDA is ready at ${hosted ? process.env.FIDA_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL : `http://127.0.0.1:${port}`}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => {
    try { await app.dispose?.(); } finally { process.exit(0); }
  }));
}
