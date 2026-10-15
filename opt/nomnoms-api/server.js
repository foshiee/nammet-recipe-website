// nomnoms API: login and recipe import for the static recipe site.
// nginx proxies /api/ here; everything else is still served by nginx directly.
//
//   GET  /api/me        -> { user } (null when signed out)
//   POST /api/login     { username, password }
//   POST /api/logout
//   POST /api/import    multipart "file", or JSON { url } or { text }  -> draft recipe (nothing saved)
//   POST /api/recipes   { slug, recipe, overwrite? }                   -> writes recipes/<slug>.json
//
// Every POST must carry the header "X-Requested-With: nomnoms". Browsers won't
// send a custom header cross-site without a CORS preflight, which this server
// never approves, so this together with SameSite=Strict cookies blocks CSRF.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import busboy from 'busboy';
import { config } from './config.js';
import * as auth from './auth.js';
import { importFile, importText, importUrl, ImportError } from './import/index.js';
import { validateRecipe } from './import/validate.js';
import { saveRecipe, SaveError } from './save.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- helpers ---------- */

function send(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(data);
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const forwarded = req.headers['x-real-ip'];
  return forwarded && config.trustedProxies.includes(remote) ? String(forwarded) : remote;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'The request is too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 1024 * 1024) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected JSON.');
  try {
    return JSON.parse((await readBody(req, limit)).toString('utf8') || '{}');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

function readUpload(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: config.maxUploadBytes, fields: 5, fieldSize: 64 * 1024 } });
    } catch {
      return reject(new HttpError(400, 'The upload could not be read.'));
    }
    let file = null;
    let tooBig = false;
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('limit', () => { tooBig = true; });
      stream.on('end', () => { file = { buffer: Buffer.concat(chunks), filename: info.filename }; });
    });
    bb.on('error', () => reject(new HttpError(400, 'The upload could not be read.')));
    bb.on('close', () => {
      if (tooBig) return reject(new HttpError(413, `Files must be under ${Math.round(config.maxUploadBytes / 1048576)} MB.`));
      if (!file) return reject(new HttpError(400, 'No file was uploaded.'));
      resolve(file);
    });
    req.pipe(bb);
  });
}

function currentUser(req) {
  return auth.getSession(cookies(req)[auth.COOKIE]);
}

function requireUser(req) {
  const s = currentUser(req);
  if (!s) throw new HttpError(401, 'Please sign in.');
  return s;
}

/* ---------- routes ---------- */

let importsRunning = 0;
const MAX_IMPORTS = 4;

const routes = {
  'GET /api/me': async (req, res) => {
    const s = currentUser(req);
    send(res, 200, { user: s ? { username: s.username, role: s.role } : null });
  },

  'POST /api/login': async (req, res) => {
    const { username, password } = await readJson(req, 16 * 1024);
    const result = await auth.login(username, password, clientIp(req));
    if (result.error === 'rate') throw new HttpError(429, 'Too many failed sign-in attempts. Wait 15 minutes and try again.');
    if (result.error) throw new HttpError(401, 'Wrong user name or password.');
    console.log(`login ok: ${result.user.username} from ${clientIp(req)}`);
    send(res, 200, { user: result.user }, { 'Set-Cookie': auth.sessionCookie(result.token) });
  },

  'POST /api/logout': async (req, res) => {
    auth.logout(cookies(req)[auth.COOKIE]);
    send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  },

  'POST /api/import': async (req, res) => {
    const user = requireUser(req);
    if (importsRunning >= MAX_IMPORTS) throw new HttpError(503, 'Several imports are already running. Try again in a moment.');
    importsRunning++;
    try {
      let result;
      let what;
      if (/^multipart\/form-data\b/i.test(req.headers['content-type'] || '')) {
        const file = await readUpload(req);
        what = `file ${file.filename || '(unnamed)'} (${file.buffer.length} bytes)`;
        result = await importFile(file.buffer);
      } else {
        const body = await readJson(req, config.maxUploadBytes);
        if (body.url) {
          what = `url ${body.url}`;
          result = await importUrl(body.url, config.maxFetchBytes);
        } else {
          what = `text (${String(body.text || '').length} chars)`;
          result = await importText(body.text);
        }
      }
      console.log(`import by ${user.username}: ${what} -> ${result.method}`);
      send(res, 200, result);
    } finally {
      importsRunning--;
    }
  },

  'POST /api/recipes': async (req, res) => {
    const user = requireUser(req);
    const { slug, recipe, overwrite } = await readJson(req, 512 * 1024);
    const v = validateRecipe(recipe);
    if (v.errors.length) return send(res, 422, { error: 'The recipe has problems that need fixing first.', errors: v.errors, warnings: v.warnings });
    const saved = await saveRecipe(slug, v.recipe, { overwrite: overwrite === true });
    console.log(`saved by ${user.username}: ${saved.file}${overwrite ? ' (replaced)' : ''}`);
    send(res, 201, { ...saved, warnings: v.warnings });
  }
};

/* ---------- local testing: serve the static site too ---------- */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

async function serveStatic(req, res) {
  const root = path.resolve(config.devStaticRoot);
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, urlPath);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 404, { error: 'Not found' });
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) {
      if (urlPath.replace(/\/$/, '').endsWith('/recipes')) {
        // Emulates nginx "autoindex_format json" for the recipe folder
        const entries = await fs.readdir(file, { withFileTypes: true });
        return send(res, 200, entries.filter((e) => !e.name.startsWith('.')).map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' })));
      }
      return serveStatic({ ...req, url: urlPath.replace(/\/?$/, '/index.html') }, res);
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await fs.readFile(file));
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  try {
    if (!pathname.startsWith('/api/')) {
      if (config.devStaticRoot && req.method === 'GET') return await serveStatic(req, res);
      throw new HttpError(404, 'Not found.');
    }
    const handler = routes[`${req.method} ${pathname}`];
    if (!handler) throw new HttpError(404, 'Not found.');
    if (req.method === 'POST' && req.headers['x-requested-with'] !== 'nomnoms') throw new HttpError(403, 'Missing request header.');
    await handler(req, res);
  } catch (e) {
    const status = e instanceof HttpError || e instanceof ImportError || e instanceof SaveError ? e.status : 500;
    if (status === 500) console.error(`${req.method} ${pathname}:`, e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message });
  }
});

server.requestTimeout = 120_000;
server.listen(config.port, config.host, () => {
  console.log(`nomnoms-api listening on http://${config.host}:${config.port}`);
  console.log(`recipes: ${path.resolve(config.recipesDir)}  users: ${path.resolve(config.usersFile)}`);
  if (config.devStaticRoot) console.log(`dev mode: also serving ${path.resolve(config.devStaticRoot)}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('ANTHROPIC_API_KEY is not set: PDF, photo and plain-text imports are disabled.');
});
