// nammet API: login, recipe import and the admin page for the static recipe site.
// nginx proxies /api/ here; everything else is still served by nginx directly.
//
//   GET  /api/me        -> { user } (null when signed out)
//   POST /api/login     { username, password }
//   POST /api/logout
//   POST /api/password  { current, password }   any signed-in user choosing their own password
//
// A user whose password was set by someone else has mustChangePassword: true and gets 403
// from every route below until they've used /api/password.
//
// Importers and admins:
//   POST /api/import    multipart "file", or JSON { url } or { text }  -> draft recipe (nothing saved)
//   GET  /api/recipes/file?slug=   -> { recipe, version }, the saved file for editing
//   POST /api/recipes   { slug, recipe, overwrite?, version? }         -> writes recipes/<slug>.json
//                       (with version, 409 { changed: true } if the file has changed since)
//   POST /api/recipes/photo          multipart "slug" + "file" (JPEG)    -> writes photos/, sets "image"
//   POST /api/recipes/photo/delete   { slug }
//
// Admins only:
//   POST /api/recipes/delete       { slug, version? }   removes the recipe and its photo
//                                  (with version, 409 { changed: true } if the file has changed since)
//   GET  /api/admin/settings       -> appearance, Claude settings (never the key itself), options
//   POST /api/admin/appearance     { siteName, favicon, theme, colors, fonts, radius }
//   POST /api/admin/favicon        multipart "file" (PNG, ICO or WebP)
//   POST /api/admin/ai             { model, effort } (null = server default)
//   POST /api/admin/api-key        { key } (empty removes it)
//   POST /api/admin/api-key/test
//   GET  /api/admin/users          -> { users: [{ username, role }] }
//   POST /api/admin/users          { username, password, role }
//   POST /api/admin/users/update   { username, role?, password? }
//   POST /api/admin/users/delete   { username }
//
// Every POST must carry the header "X-Requested-With: nammet". Browsers won't
// send a custom header cross-site without a CORS preflight, which this server
// never approves, so this together with SameSite=Strict cookies blocks CSRF.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import busboy from 'busboy';
import { config } from './config.js';
import * as auth from './auth.js';
import * as settings from './settings.js';
import { importFile, importText, importUrl, ImportError } from './import/index.js';
import { testKey, LlmError } from './import/llm.js';
import { validateRecipe } from './import/validate.js';
import { readRecipeFile, saveRecipe, SaveError } from './save.js';
import * as photos from './photos.js';

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

function readUpload(req, maxBytes = config.maxUploadBytes) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes, fields: 5, fieldSize: 64 * 1024 } });
    } catch {
      return reject(new HttpError(400, 'The upload could not be read.'));
    }
    let file = null;
    let tooBig = false;
    const fields = {};
    bb.on('field', (name, value) => { fields[name] = value; });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('limit', () => { tooBig = true; });
      stream.on('end', () => { file = { buffer: Buffer.concat(chunks), filename: info.filename, fields }; });
    });
    bb.on('error', () => reject(new HttpError(400, 'The upload could not be read.')));
    bb.on('close', () => {
      if (tooBig) {
        const size = maxBytes < 1048576 ? `${Math.round(maxBytes / 1024)} KB` : `${Math.round(maxBytes / 1048576)} MB`;
        return reject(new HttpError(413, `Files must be under ${size}.`));
      }
      if (!file) return reject(new HttpError(400, 'No file was uploaded.'));
      resolve(file);
    });
    req.pipe(bb);
  });
}

function currentUser(req) {
  return auth.getSession(cookies(req)[auth.COOKIE]);
}

function requireRole(req, ...roles) {
  const s = currentUser(req);
  if (!s) throw new HttpError(401, 'Please sign in.');
  if (s.mustChangePassword) throw new HttpError(403, 'Choose a new password first.');
  if (!roles.includes(s.role)) throw new HttpError(403, roles.length === 1 ? 'Admins only.' : "Your account can't do that.");
  return s;
}

const requireImporter = (req) => requireRole(req, 'admin', 'importer');
const requireAdmin = (req) => requireRole(req, 'admin');

function adminSettings() {
  return {
    appearance: settings.appearance(),
    defaults: settings.DEFAULT_APPEARANCE,
    ai: { ...settings.aiSettings(), key: settings.keyStatus() },
    options: {
      colors: settings.COLORS,
      themes: settings.THEMES,
      contrast: settings.CONTRAST,
      fonts: settings.FONTS,
      radius: settings.RADIUS,
      models: settings.MODELS,
      efforts: settings.EFFORTS,
      roles: auth.ROLES
    }
  };
}

/* ---------- routes ---------- */

let importsRunning = 0;
const MAX_IMPORTS = 4;

const routes = {
  'GET /api/me': async (req, res) => {
    const s = currentUser(req);
    send(res, 200, { user: s ? auth.publicUser(s) : null });
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

  'POST /api/password': async (req, res) => {
    const s = currentUser(req);
    if (!s) throw new HttpError(401, 'Please sign in.');
    const { current, password } = await readJson(req, 16 * 1024);
    const result = await auth.changePassword(s.username, current, password, clientIp(req), cookies(req)[auth.COOKIE]);
    if (result.error === 'rate') throw new HttpError(429, 'Too many failed attempts. Wait 15 minutes and try again.');
    console.log(`password changed: ${s.username} from ${clientIp(req)}`);
    send(res, 200, { user: result.user });
  },

  'POST /api/import': async (req, res) => {
    const user = requireImporter(req);
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

  'GET /api/recipes/file': async (req, res) => {
    requireImporter(req);
    const slug = new URL(req.url, 'http://x').searchParams.get('slug') || '';
    send(res, 200, await readRecipeFile(slug));
  },

  'POST /api/recipes': async (req, res) => {
    const user = requireImporter(req);
    const { slug, recipe, overwrite, version } = await readJson(req, 512 * 1024);
    const v = validateRecipe(recipe);
    if (v.errors.length) return send(res, 422, { error: 'The recipe has problems that need fixing first.', errors: v.errors, warnings: v.warnings });
    const saved = overwrite === true
      ? await photos.replaceRecipe(slug, v.recipe, typeof version === 'string' ? version : undefined)
      : await saveRecipe(slug, v.recipe);
    console.log(`saved by ${user.username}: ${saved.file}${overwrite ? ' (replaced)' : ''}`);
    send(res, 201, { ...saved, warnings: v.warnings });
  },

  'POST /api/recipes/photo': async (req, res) => {
    const user = requireImporter(req);
    if (!/^multipart\/form-data\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected a file upload.');
    const file = await readUpload(req, photos.MAX_PHOTO_BYTES);
    const slug = String(file.fields.slug || '');
    const result = await photos.setPhoto(slug, file.buffer);
    console.log(`photo by ${user.username}: ${result.image} for ${slug} (${file.buffer.length} bytes)`);
    send(res, 200, result);
  },

  'POST /api/recipes/photo/delete': async (req, res) => {
    const user = requireImporter(req);
    const { slug } = await readJson(req, 16 * 1024);
    const result = await photos.removePhoto(String(slug || ''));
    console.log(`photo removed by ${user.username}: ${slug}`);
    send(res, 200, result);
  },

  'POST /api/recipes/delete': async (req, res) => {
    const user = requireAdmin(req);
    const { slug, version } = await readJson(req, 16 * 1024);
    const result = await photos.deleteRecipe(String(slug || ''), typeof version === 'string' ? version : undefined);
    console.log(`recipe deleted by ${user.username}: ${result.slug}`);
    send(res, 200, result);
  },

  /* ---------- admin ---------- */

  'GET /api/admin/settings': async (req, res) => {
    requireAdmin(req);
    send(res, 200, adminSettings());
  },

  'POST /api/admin/appearance': async (req, res) => {
    const user = requireAdmin(req);
    await settings.saveAppearance(await readJson(req, 64 * 1024));
    console.log(`admin ${user.username}: changed the appearance`);
    send(res, 200, adminSettings());
  },

  'POST /api/admin/favicon': async (req, res) => {
    const user = requireAdmin(req);
    if (!/^multipart\/form-data\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected a file upload.');
    const file = await readUpload(req, settings.MAX_FAVICON_BYTES);
    await settings.saveFaviconImage(file.buffer);
    console.log(`admin ${user.username}: uploaded a site icon (${file.buffer.length} bytes)`);
    send(res, 200, adminSettings());
  },

  'POST /api/admin/ai': async (req, res) => {
    const user = requireAdmin(req);
    await settings.saveAi(await readJson(req, 16 * 1024));
    const { model, effort } = settings.aiConfig();
    console.log(`admin ${user.username}: Claude imports now use ${model} at ${effort} effort`);
    send(res, 200, adminSettings());
  },

  // Write-only: the key is never sent back, and never logged.
  'POST /api/admin/api-key': async (req, res) => {
    const user = requireAdmin(req);
    const { key } = await readJson(req, 16 * 1024);
    await settings.saveApiKey(key);
    console.log(`admin ${user.username}: ${key ? 'set' : 'removed'} the Anthropic API key`);
    send(res, 200, adminSettings());
  },

  'POST /api/admin/api-key/test': async (req, res) => {
    requireAdmin(req);
    await testKey();
    send(res, 200, { ok: true });
  },

  'GET /api/admin/users': async (req, res) => {
    requireAdmin(req);
    send(res, 200, { users: await auth.listUsers() });
  },

  'POST /api/admin/users': async (req, res) => {
    const user = requireAdmin(req);
    const { username, password, role } = await readJson(req, 16 * 1024);
    const created = await auth.createUser({ username, password, role, temporary: true });
    console.log(`admin ${user.username}: added ${created.username} (${created.role})`);
    send(res, 201, { users: await auth.listUsers() });
  },

  'POST /api/admin/users/update': async (req, res) => {
    const user = requireAdmin(req);
    const { username, role, password } = await readJson(req, 16 * 1024);
    const changes = {};
    if (role !== undefined) changes.role = role;
    if (password !== undefined) changes.password = password;
    const what = Object.keys(changes).join(' and ');
    if (!what) throw new HttpError(400, 'Nothing to change.');
    // A password set for someone else is temporary: they choose their own at next sign-in.
    // Resetting your own keeps you signed in here but signs out your other sessions.
    if (password !== undefined) changes.temporary = username !== user.username;
    await auth.updateUser(String(username || ''), changes, { keepToken: cookies(req)[auth.COOKIE] });
    console.log(`admin ${user.username}: changed ${what} for ${username}`);
    send(res, 200, { users: await auth.listUsers() });
  },

  'POST /api/admin/users/delete': async (req, res) => {
    const user = requireAdmin(req);
    const { username } = await readJson(req, 16 * 1024);
    if (username === user.username) throw new HttpError(409, "You can't remove your own account.");
    await auth.deleteUser(String(username || ''));
    console.log(`admin ${user.username}: removed ${username}`);
    send(res, 200, { users: await auth.listUsers() });
  }
};

/* ---------- local testing: serve the static site too ---------- */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

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
    if (req.method === 'POST' && req.headers['x-requested-with'] !== 'nammet') throw new HttpError(403, 'Missing request header.');
    await handler(req, res);
  } catch (e) {
    const known = [HttpError, ImportError, SaveError, LlmError, settings.SettingsError, auth.UserError, photos.PhotoError];
    const status = known.some((k) => e instanceof k) ? e.status : 500;
    if (status === 500) console.error(`${req.method} ${pathname}:`, e);
    if (!res.headersSent) send(res, status, status === 500 ? { error: 'Something went wrong on the server.' } : { error: e.message, ...e.data });
  }
});

await settings.loadSettings();

server.requestTimeout = 120_000;
server.listen(config.port, config.host, () => {
  console.log(`nammet-api listening on http://${config.host}:${config.port}`);
  console.log(`recipes: ${path.resolve(config.recipesDir)}  photos: ${path.resolve(config.photosDir)}  users: ${path.resolve(config.usersFile)}`);
  console.log(`settings: ${path.resolve(config.settingsFile)}  theme: ${path.resolve(config.themeDir)}`);
  if (config.devStaticRoot) console.log(`dev mode: also serving ${path.resolve(config.devStaticRoot)}`);
  if (!settings.keyStatus().set) console.log('No Anthropic API key is set: PDF, photo and plain-text imports are disabled until one is added.');
});
