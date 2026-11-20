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
  ...Object.fromEntries(['report_32_item.svg', 'semantic_model_32_item.svg', 'power_bi_32_color.svg'].map(name => [`/icons/${name}`, [join('icons', name), 'image/svg+xml']]))
};

export function createApp({ dataDir = join(ROOT, 'data'), toolkit = createToolkitRunner() } = {}) {
  const csrfToken = randomBytes(32).toString('hex');
  const jobs = new Map(), pendingWrites = new Set();
  let activeJob = null, signingOut = false, accountCache = null, accountPromise = null;
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
    if (activeJob || signingOut) throw new InputError('Another sign-in or publishing operation is running.', 409);
    const job = { id: randomUUID(), kind, projectId, status: 'running', startedAt: new Date().toISOString(), logs: [], result: null, error: null };
    jobs.set(job.id, job); activeJob = job.id;
    while (jobs.size > 30) jobs.delete(jobs.keys().next().value);
    const log = message => {
      for (const line of redact(message).split(/\r?\n/).filter(Boolean)) job.logs.push(line.slice(0, 4000));
      job.logs = job.logs.slice(-600);
    };
    Promise.resolve().then(() => run(log)).then(result => { job.result = result; job.status = 'succeeded'; }).catch(error => {
      job.error = redact(error.message); job.status = 'failed'; log(job.error);
    }).finally(() => { job.finishedAt = new Date().toISOString(); activeJob = null; });
    return job;
  }
  async function existingEnv(id) {
    try { return parseEnvironment(await readFile(join(projectPath(id), 'workspace', 'env', '.env.dev'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return {}; }
  }
  async function writeWorkspace(project) {
    const workspace = join(projectPath(project.id), 'workspace');
    const files = generateFiles(project, await existingEnv(project.id));
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
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      if (!allowedHosts.includes(req.headers.host)) throw new InputError('Unrecognized host.', 403);
      if (req.headers.origin && !allowedHosts.map(h => `http://${h}`).includes(req.headers.origin)) throw new InputError('Cross-origin requests are not allowed.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new InputError('Cross-site requests are not allowed.', 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (staticFiles[url.pathname] && req.method === 'GET') {
        const [file, type] = staticFiles[url.pathname];
        let content = await readFile(join(ROOT, 'public', file));
        const nonce = randomBytes(18).toString('base64');
        if (file === 'index.html') content = Buffer.from(content.toString('utf8').replaceAll('__NONCE__', nonce));
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
        res.writeHead(200, { 'Content-Type': type }); return res.end(content);
      }
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') return json(res, 200, { csrfToken, publishingScope: 'personal' });
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
      if (url.pathname === '/api/sources/parse' && req.method === 'POST') return json(res, 200, parsePowerBiUrl((await body(req)).url));
      if (url.pathname === '/api/projects' && req.method === 'GET') {
        await mkdir(projectsDir, { recursive: true });
        const ids = (await readdir(projectsDir, { withFileTypes: true })).filter(d => d.isDirectory() && UUID.test(d.name)).map(d => d.name);
        const projects = await Promise.all(ids.map(loadProject));
        return json(res, 200, projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, name, description, updatedAt, reports, skills, deployment }) => ({ id, name, description, updatedAt, reportCount: reports.length, skillCount: skills.length, deployment })));
      }
      if (url.pathname === '/api/projects' && req.method === 'POST') {
        await body(req);
        const project = newProject(); await storeProject(project);
        return json(res, 201, project);
      }
      const match = /^\/api\/projects\/([0-9a-f-]+)(?:\/(files|check|download|package|publish))?$/.exec(url.pathname);
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
      if (action === 'check' && req.method === 'GET') return json(res, 200, validateProject(project, { publish: true }));
      if (action === 'files' && req.method === 'GET') {
        const check = validateProject(project);
        if (!check.valid) return json(res, 200, { ...check, files: [] });
        const files = generateFiles(project, await existingEnv(id));
        return json(res, 200, { ...check, files: Object.entries(files).map(([path, value]) => ({ path, binary: typeof value !== 'string', content: typeof value === 'string' ? value : `[Generated PNG icon, ${value.length} bytes]` })) });
      }
      if (action === 'download' && req.method === 'GET') {
        const files = generateFiles(project, await existingEnv(id));
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
        if (input.confirmPersonal !== true) throw new InputError('Confirm personal publishing before deployment.');
        const check = validateProject(project, { publish: true });
        if (!check.valid) throw new InputError(check.errors.join(' '));
        if (pendingWrites.has(id)) throw new InputError('Wait for the draft to finish saving.', 409);
        return json(res, 202, startJob('publish', id, async log => {
          log(`Publishing "${project.name}" for the currently signed-in Microsoft 365 account. Scope: personal.`);
          const workspace = await writeWorkspace(project);
          log('Generated manifests, instructions, skill files and project source.');
          log('Running Microsoft Toolkit provisioning, official package validation and personal Copilot deployment.');
          const result = await toolkit(['provision', '--env', 'dev', '--folder', workspace, '--interactive', 'false'], { cwd: workspace, onOutput: log });
          if (result.code !== 0) throw new Error(result.timedOut ? 'Publishing timed out. Inspect the Toolkit log and deployment state before retrying.' : 'Microsoft Toolkit could not complete publishing. Inspect the log; provisioned identities are preserved for retries.');
          const environment = await existingEnv(id);
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
            shareLink: safeCopilotLink(environment.SHARE_LINK),
            scope: 'personal', packageId
          };
          project.deployment = deployment; project.revision++; project.updatedAt = deployment.publishedAt;
          await storeProject(project);
          log(`Published agent identity: ${deployment.agentId}`);
          log('Personal provisioning completed. Copilot availability can take time to propagate.');
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
  return { server, accountStatus, dataDir };
}

function safeCopilotLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && ['m365.cloud.microsoft', 'copilot.cloud.microsoft', 'www.microsoft365.com'].includes(url.hostname)) return url.href;
  } catch {}
  return 'https://m365.cloud.microsoft/chat/';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const { server } = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`Copilot Analytics Studio is ready at http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
