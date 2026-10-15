// Users, passwords, sessions and login rate limiting.
//
// Users live in a JSON file outside the web root:
//   [{ "username": "yourname", "passwordHash": "scrypt$...", "role": "admin" }]
// Manage it with tools/add-user.js. The file is re-read on every login, so
// adding or removing a user takes effect without restarting the service.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const scryptOpts = (N, r, p) => ({ N, r, p, maxmem: 128 * N * r * 2 });

export const USERNAME_RE = /^[a-z0-9_.-]{1,32}$/;
export const MIN_PASSWORD = 12;

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
  if (!user || !ok) {
    recordFailure(ip, username);
    return { error: 'invalid' };
  }

  failures.delete('user:' + username);
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { username: user.username, role: user.role || 'admin', expires: Date.now() + config.sessionHours * 3600e3 });
  return { token, user: { username: user.username, role: user.role || 'admin' } };
}

export function logout(token) {
  if (token) sessions.delete(token);
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
