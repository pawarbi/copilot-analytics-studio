import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { InputError } from './generator.mjs';
import { createWebIdentity } from './web-identity.mjs';
import { createHostedToolkit, createPublishingGate } from './hosted-toolkit.mjs';

const COOKIE = '__Host-fida';
const hosting = { mode: 'hosted', ephemeral: true, idleMinutes: 30 };

export async function createHostedApp({
  origin, clientId, clientSecret, dataDir, now = Date.now, maxSessions = 24,
  identityFactory = options => createWebIdentity(options),
  toolkitFactory = options => createHostedToolkit(options)
}) {
  const publicUrl = new URL(origin);
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password ||
    publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('Hosted FIDA requires an HTTPS public origin without a path.');
  origin = publicUrl.origin;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId ?? '') || !clientSecret) throw new Error('Set FIDA_CLIENT_ID and FIDA_CLIENT_SECRET in the hosting environment.');
  const root = dataDir ?? await mkdtemp(join(tmpdir(), 'fida-hosted-'));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const sessions = new Map(), gate = createPublishingGate();
  const site = createApp({ origin, hosting, toolkit: async () => { throw new Error('The public site cannot run account operations.'); } });
  let creating = 0;
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const cookie = (res, value = '') => res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax${value ? '' : '; Max-Age=0'}`);
  const expired = entry => now() - entry.touched > (entry.identity.status().signedIn ? 30 : 5) * 60 * 1000 || now() - entry.created > 8 * 60 * 60 * 1000;
  async function discard(id, entry) {
    sessions.delete(id);
    try { await entry.identity.clear(); }
    finally { await rm(entry.dir, { recursive: true, force: true }); }
  }
  async function prune() {
    for (const [id, entry] of sessions) {
      if (expired(entry) && !entry.inFlight && !entry.app.isBusy()) await discard(id, entry);
    }
  }
  async function createSession() {
    await prune();
    if (sessions.size + creating >= maxSessions) throw new InputError('The free community preview is at capacity. Please try again later.', 429);
    creating++;
    const id = randomBytes(32).toString('hex'), dir = join(root, randomUUID());
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const identity = identityFactory({ origin, clientId, clientSecret });
      const toolkit = toolkitFactory({ identity, gate, homeDir: join(dir, 'runtime') });
      const entry = {
        dir, identity, app: createApp({ origin, hosting, toolkit, dataDir: join(dir, 'data') }),
        created: now(), touched: now(), csrf: null, inFlight: 0
      };
      sessions.set(id, entry);
      return { id, entry };
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    } finally { creating--; }
  }
  async function smallBody(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json.', 415);
    let text = '';
    for await (const chunk of req) {
      text += chunk.toString('utf8');
      if (Buffer.byteLength(text) > 4000) throw new InputError('Request is too large.', 413);
    }
    try { return JSON.parse(text || '{}'); } catch { throw new InputError('Invalid JSON.'); }
  }
  const timer = setInterval(() => { void prune().catch(() => {}); }, 60000);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      if (req.url === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
      if (req.headers.host !== publicUrl.host) throw new InputError('Unrecognized host.', 403);
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw new InputError('Unrecognized origin.', 403);
      const callback = url.pathname === '/auth/callback' && req.method === 'GET';
      if (!callback && (req.headers.origin && req.headers.origin !== origin ||
        req.headers['sec-fetch-site'] === 'cross-site' && url.pathname.startsWith('/api/'))) throw new InputError('Cross-origin requests are not allowed.', 403);
      const id = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      let entry = sessions.get(id);
      if (entry && expired(entry) && !entry.inFlight && !entry.app.isBusy()) { await discard(id, entry); entry = null; }
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
        if (!entry) {
          const created = await createSession();
          entry = created.entry; cookie(res, created.id);
        }
        entry.touched = now();
        entry.csrf ??= randomBytes(32).toString('hex');
        const loginError = entry.loginError; entry.loginError = null;
        return json(res, 200, { csrfToken: entry.csrf, publishingScopes: ['personal', 'shared'], hosting, ...(loginError ? { loginError } : {}) });
      }
      if (!callback && !url.pathname.startsWith('/api/')) return site.server.emit('request', req, res);
      if (!entry) return json(res, 401, { error: 'Your temporary session expired. Start a new session; published agents are not deleted.', code: 'session_expired' });
      entry.touched = now(); entry.inFlight++;
      let finished = false;
      const finish = () => { if (!finished) { finished = true; entry.inFlight--; } };
      res.once('finish', finish); res.once('close', finish);
      if (callback) {
        let redirect;
        try {
          redirect = await entry.identity.complete(url.searchParams);
          entry.app.invalidateAccount();
        } catch (error) {
          const code = String(error.errorCode ?? 'signin_failed').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
          entry.loginError = `Microsoft sign-in did not complete (${code}). Check consent and the registered redirect URI, then try again.`;
        }
        res.writeHead(303, { Location: redirect ?? `${origin}/` }); return res.end();
      }
      if (!entry.csrf || req.headers['x-studio-token'] !== entry.csrf) throw new InputError('Reload FIDA to establish your session.', 403);
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        const input = await smallBody(req);
        const redirect = await entry.identity.begin({ tenant: input.tenant ?? '' });
        return json(res, 200, { redirect });
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        await smallBody(req);
        if (entry.app.isBusy() || entry.inFlight > 1) throw new InputError('Wait for your current operation before signing out.', 409);
        await discard(id, entry); cookie(res);
        return json(res, 200, { signedIn: false, account: null });
      }
      if (req.method === 'POST' && /^\/api\/projects\/[0-9a-f-]+\/(?:publish|sharing)$/.test(url.pathname)) {
        if (entry.app.isBusy()) throw new InputError('Wait for your current operation.', 409);
        const redirect = await entry.identity.connectPublishing();
        if (redirect) { req.resume(); return json(res, 200, { redirect }); }
      }
      // Each inner application owns its projects, account cache and operation locks.
      req.headers['x-studio-token'] = entry.app.csrfToken;
      entry.app.server.emit('request', req, res);
    } catch (error) {
      if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : 'The hosted operation failed. Retry sign-in or use the local edition.' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.once('close', () => clearInterval(timer));
  return {
    server, dataDir: root, prune,
    async dispose() {
      clearInterval(timer);
      for (const [id, entry] of sessions) {
        if (!entry.app.isBusy()) await discard(id, entry);
      }
    }
  };
}
