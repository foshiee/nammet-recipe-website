// Users, passwords, sessions and login rate limiting.
//
// Users live in a JSON file outside the web root:
//   [{ "username": "yourname", "passwordHash": "scrypt$...", "role": "admin" }]
// Manage it from the admin page or with tools/add-user.js. The file is re-read on
// every login, so changes made with the tool take effect without a restart.
//
// Roles: "admin" can do everything, including the admin page. "importer" can only
// import and save recipes. A user without a role is an importer.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const scryptOpts = (N, r, p) => ({ N, r, p, maxmem: 128 * N * r * 2 });

export const USERNAME_RE = /^[a-z0-9_.-]{1,32}$/;
export const MIN_PASSWORD = 12;
export const ROLES = ['admin', 'importer'];

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const roleOf = (user) => user.role || 'importer';

/* ---------- passwords ---------- */

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(String(password).normalize('NFKC'), salt, keylen, scryptOpts(N, r, p));
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'),
    expected.length, scryptOpts(Number(N), Number(r), Number(p)));
  return crypto.timingSafeEqual(actual, expected);
}

// Spent on unknown usernames so a login takes the same time whether or not the user exists.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

/* ---------- users file ---------- */

export async function readUsers(file = config.usersFile) {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function writeUsers(users, file = config.usersFile) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(users, null, 2) + '\n', { mode: 0o640 });
  await fs.rename(tmp, file);
}

/* ---------- managing users ---------- */

// Admin page requests can overlap, so changes to the file run one at a time.
let queue = Promise.resolve();
function changeUsers(fn, file = config.usersFile) {
  const run = queue.then(async () => {
    const users = await readUsers(file);
    const result = await fn(users);
    await writeUsers(users, file);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new UserError(`Passwords must be at least ${MIN_PASSWORD} characters.`);
  }
}

function checkRole(role) {
  if (!ROLES.includes(role)) throw new UserError(`Role must be one of: ${ROLES.join(', ')}.`);
}

function findUser(users, username) {
  const user = users.find((u) => u.username === username);
  if (!user) throw new UserError(`There's no user called ${username}.`, 404);
  return user;
}

const adminCount = (users) => users.filter((u) => roleOf(u) === 'admin').length;

export async function listUsers(file) {
  return (await readUsers(file)).map((u) => ({ username: u.username, role: roleOf(u) }));
}

export async function createUser({ username, password, role }, file) {
  username = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new UserError('User names are 1-32 characters: lowercase letters, numbers, ".", "_" or "-".');
  checkRole(role);
  checkPassword(password);
  const passwordHash = await hashPassword(password);
  return changeUsers((users) => {
    if (users.some((u) => u.username === username)) throw new UserError(`There's already a user called ${username}.`, 409);
    users.push({ username, passwordHash, role });
    return { username, role };
  }, file);
}

// changes: { role?, password? }. A new role applies to the user's open sessions straight
// away; a new password signs them out everywhere except keepToken (the admin's own session).
export async function updateUser(username, changes, { keepToken, file } = {}) {
  if (changes.role !== undefined) checkRole(changes.role);
  if (changes.password !== undefined) checkPassword(changes.password);
  const passwordHash = changes.password !== undefined ? await hashPassword(changes.password) : null;
  const result = await changeUsers((users) => {
    const user = findUser(users, username);
    if (changes.role !== undefined && changes.role !== 'admin' && roleOf(user) === 'admin' && adminCount(users) === 1) {
      throw new UserError(`${username} is the only admin. Make someone else an admin first.`, 409);
    }
    if (changes.role !== undefined) user.role = changes.role;
    if (passwordHash) user.passwordHash = passwordHash;
    return { username: user.username, role: roleOf(user) };
  }, file);
  if (passwordHash) dropSessions(username, keepToken);
  for (const s of sessions.values()) if (s.username === username) s.role = result.role;
  return result;
}

export async function deleteUser(username, { file } = {}) {
  await changeUsers((users) => {
    const user = findUser(users, username);
    if (roleOf(user) === 'admin' && adminCount(users) === 1) {
      throw new UserError(`${username} is the only admin and can't be removed.`, 409);
    }
    users.splice(users.indexOf(user), 1);
  }, file);
  dropSessions(username);
}

/* ---------- rate limiting ---------- */

const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { ip: 10, user: 5 };
const failures = new Map(); // key -> [timestamps]

function recent(key) {
  const now = Date.now();
  const list = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

export function isRateLimited(ip, username) {
  return recent('ip:' + ip).length >= LIMITS.ip || recent('user:' + username).length >= LIMITS.user;
}

function recordFailure(ip, username) {
  for (const key of ['ip:' + ip, 'user:' + username]) failures.set(key, [...recent(key), Date.now()]);
}

/* ---------- sessions ---------- */

// In memory: a service restart signs everyone out, which is fine for a handful of users.
const sessions = new Map(); // token -> { username, role, expires }

export const COOKIE = 'nomnoms_session';

export async function login(username, password, ip) {
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');

  if (isRateLimited(ip, username)) return { error: 'rate' };

  const user = (await readUsers()).find((u) => u.username === username);
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok || !ROLES.includes(roleOf(user))) {
    recordFailure(ip, username);
    return { error: 'invalid' };
  }

  failures.delete('user:' + username);
  const token = crypto.randomBytes(32).toString('base64url');
  const role = roleOf(user);
  sessions.set(token, { username: user.username, role, expires: Date.now() + config.sessionHours * 3600e3 });
  return { token, user: { username: user.username, role } };
}

export function logout(token) {
  if (token) sessions.delete(token);
}

export function dropSessions(username, exceptToken) {
  for (const t of [...sessions.keys()]) if (sessions.get(t).username === username && t !== exceptToken) sessions.delete(t);
}

export function getSession(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

export function sessionCookie(token) {
  const parts = [`${COOKIE}=${token}`, 'Path=/api', 'HttpOnly', 'SameSite=Strict', `Max-Age=${config.sessionHours * 3600}`];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  const parts = [`${COOKIE}=`, 'Path=/api', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

// Housekeeping so the maps don't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
  for (const key of failures.keys()) recent(key);
}, 10 * 60 * 1000).unref();
