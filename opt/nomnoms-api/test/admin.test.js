// Run with: npm test   (no network or API key needed)
// Settings, theme generation and user management, against files in a temp folder.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nomnoms-admin-'));
process.env.SETTINGS_FILE = path.join(tmp, 'settings.json');
process.env.THEME_DIR = path.join(tmp, 'theme');
process.env.USERS_FILE = path.join(tmp, 'users.json');
process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env-0000000000000000wxyz';
delete process.env.MODEL;
delete process.env.EFFORT;

// Imported after the environment is set, because config.js reads it once
const settings = await import('../settings.js');
const auth = await import('../auth.js');

before(async () => {
  await fs.mkdir(process.env.THEME_DIR);
  await settings.loadSettings();
});

after(() => fs.rm(tmp, { recursive: true, force: true }));

const appearance = (changes = {}) => ({ ...structuredClone(settings.DEFAULT_APPEARANCE), ...changes });

test('appearance validation', () => {
  assert.deepEqual(settings.validateAppearance(appearance()), settings.DEFAULT_APPEARANCE);

  const injected = appearance();
  injected.colors.light.bg = '#fff;}body{display:none';
  assert.throws(() => settings.validateAppearance(injected), /colour/);

  assert.throws(() => settings.validateAppearance(appearance({ fonts: { heading: 'Comic Sans', body: 'system-sans' } })), /font/);
  assert.throws(() => settings.validateAppearance(appearance({ radius: '3px' })), /corner/);
  assert.throws(() => settings.validateAppearance(appearance({ siteName: 'x'.repeat(61) })), /site name/);
  assert.throws(() => settings.validateAppearance(appearance({ siteName: '   ' })), /site name/);
  assert.throws(() => settings.validateAppearance(appearance({ favicon: { type: 'emoji', value: 'way too long here' } })), /icon/);
  // An uploaded image can only be kept, not invented
  assert.throws(() => settings.validateAppearance(appearance({ favicon: { type: 'image', file: '../../etc/passwd' } })), /icon/);
});

test('theme css and favicon', () => {
  const css = settings.renderThemeCss(settings.DEFAULT_APPEARANCE);
  assert.match(css, /--accent: #2447b8;/);
  assert.match(css, /prefers-color-scheme: dark[\s\S]*--accent: #8eaaff;/);
  assert.match(css, /--font-heading: "Iowan Old Style"/);
  assert.match(css, /--radius: 8px;/);

  const svg = settings.renderEmojiFavicon('<&">');
  assert.ok(!svg.includes('<&">'));
  assert.match(svg, /&#60;&#38;&#34;&#62;/);
});

test('favicon sniffing', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  assert.equal(settings.sniffImage(png), 'png');
  assert.equal(settings.sniffImage(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.alloc(8)])), 'webp');
  assert.throws(() => settings.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), /PNG, ICO or WebP/);
  assert.throws(() => settings.sniffImage(Buffer.concat([png, Buffer.alloc(settings.MAX_FAVICON_BYTES)])), /under/);
});

test('saving appearance writes the public theme files', async () => {
  await settings.saveAppearance(appearance({ siteName: 'Our Kitchen', favicon: { type: 'emoji', value: '🥕' }, radius: 'round' }));
  const site = JSON.parse(await fs.readFile(path.join(process.env.THEME_DIR, 'site.json'), 'utf8'));
  assert.equal(site.name, 'Our Kitchen');
  assert.match(site.favicon, /^theme\/favicon\.svg\?v=[0-9a-f]+$/);
  assert.match(await fs.readFile(path.join(process.env.THEME_DIR, 'theme.css'), 'utf8'), /--radius: 14px;/);
  assert.match(await fs.readFile(path.join(process.env.THEME_DIR, 'favicon.svg'), 'utf8'), /🥕/);

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  await settings.saveFaviconImage(png);
  const files = await fs.readdir(process.env.THEME_DIR);
  assert.ok(files.includes('favicon.png') && !files.includes('favicon.svg'));
  assert.deepEqual(settings.appearance().favicon, { type: 'image', file: 'favicon.png' });

  const saved = JSON.parse(await fs.readFile(process.env.SETTINGS_FILE, 'utf8'));
  assert.equal(saved.appearance.siteName, 'Our Kitchen');
});

test('claude settings: admin page overrides the environment', async () => {
  assert.equal(settings.aiConfig().apiKey, process.env.ANTHROPIC_API_KEY);
  assert.deepEqual(settings.keyStatus(), { set: true, source: 'env', last4: 'wxyz' });

  await settings.saveApiKey('sk-ant-from-admin-111111111111111abcd');
  assert.equal(settings.aiConfig().apiKey, 'sk-ant-from-admin-111111111111111abcd');
  assert.deepEqual(settings.keyStatus(), { set: true, source: 'admin', last4: 'abcd' });
  assert.throws(() => settings.saveApiKey('has spaces in it, not a key'), /API key/);

  await settings.saveApiKey('');
  assert.equal(settings.keyStatus().source, 'env');

  await settings.saveAi({ model: 'claude-opus-5-5', effort: null });
  assert.equal(settings.aiConfig().model, 'claude-opus-5-5');
  assert.equal(settings.aiConfig().effort, 'medium');
  assert.throws(() => settings.validateAi({ model: 'gpt-4' }), /model/);
});

test('user management and roles', async () => {
  await auth.createUser({ username: 'Boss', password: 'correct horse battery', role: 'admin' });
  await auth.createUser({ username: 'cook', password: 'correct horse battery', role: 'importer' });
  assert.deepEqual(await auth.listUsers(), [{ username: 'boss', role: 'admin' }, { username: 'cook', role: 'importer' }]);

  await assert.rejects(auth.createUser({ username: 'cook', password: 'correct horse battery', role: 'importer' }), /already/);
  await assert.rejects(auth.createUser({ username: 'new', password: 'short', role: 'importer' }), /at least/);
  await assert.rejects(auth.createUser({ username: 'new', password: 'correct horse battery', role: 'owner' }), /Role/);

  // Never leave the site without an admin
  await assert.rejects(auth.updateUser('boss', { role: 'importer' }), /only admin/);
  await assert.rejects(auth.deleteUser('boss'), /only admin/);

  const session = await auth.login('cook', 'correct horse battery', '127.0.0.1');
  assert.equal(session.user.role, 'importer');
  await auth.updateUser('cook', { role: 'admin' });
  assert.equal(auth.getSession(session.token).role, 'admin', 'role changes apply to open sessions');
  await auth.updateUser('boss', { role: 'importer' });

  await auth.updateUser('cook', { password: 'another long password' });
  assert.equal(auth.getSession(session.token), null, 'a password reset signs the user out');

  await auth.deleteUser('boss');
  assert.deepEqual(await auth.listUsers(), [{ username: 'cook', role: 'admin' }]);

  // A user without a role is an importer; an unknown role can't sign in
  const raw = await auth.readUsers();
  raw.push({ ...raw[0], username: 'norole', role: undefined }, { ...raw[0], username: 'odd', role: 'owner' });
  await auth.writeUsers(raw);
  assert.equal((await auth.login('norole', 'another long password', '127.0.0.2')).user.role, 'importer');
  assert.equal((await auth.login('odd', 'another long password', '127.0.0.3')).error, 'invalid');
});
