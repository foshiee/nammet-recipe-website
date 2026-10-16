// Settings changed from the admin page: the site's look, and the Claude key, model and effort.
//
// The source of truth is SETTINGS_FILE (outside the web root, mode 0600, as it may hold the
// API key). Every save also regenerates public files in THEME_DIR, which the static site
// loads directly, so the site keeps its look even when this service is down:
//   theme.css    CSS variables that override the defaults at the top of style.css
//   site.json    { name, favicon } read by app.js
//   favicon.*    an SVG made from the chosen emoji, or the uploaded image
//
// Only whitelisted values ever reach theme.css (hex colours, font and radius keys),
// which is what keeps the generated CSS safe.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export class SettingsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ---------- options ---------- */

export const COLORS = {
  bg: 'Page background',
  ink: 'Text',
  muted: 'Secondary text',
  line: 'Lines and borders',
  accent: 'Accent (buttons, links)',
  'on-accent': 'Text on accent',
  tint: 'Highlight',
  field: 'Input fields',
  danger: 'Errors'
};

// System font stacks only: nothing is downloaded, so the site stays dependency-free.
export const FONTS = {
  'classic-serif': { label: 'Classic serif', stack: '"Iowan Old Style", "Palatino Linotype", Palatino, "URW Palladio L", "Book Antiqua", Georgia, serif' },
  'transitional-serif': { label: 'Book serif', stack: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif' },
  slab: { label: 'Slab serif', stack: 'Rockwell, "Rockwell Nova", "Roboto Slab", "DejaVu Serif", "Sitka Small", serif' },
  'system-sans': { label: 'System sans', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  humanist: { label: 'Humanist sans', stack: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif' },
  geometric: { label: 'Geometric sans', stack: 'Avenir, Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif' },
  rounded: { label: 'Rounded', stack: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, "Arial Rounded MT", "Arial Rounded MT Bold", Calibri, source-sans-pro, sans-serif' },
  handwritten: { label: 'Handwritten', stack: '"Segoe Print", "Bradley Hand", Chilanka, TSCu_Comic, casual, cursive' },
  mono: { label: 'Monospace', stack: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace' }
};

export const RADII = {
  square: { label: 'Square', value: '0px' },
  subtle: { label: 'Subtle', value: '4px' },
  default: { label: 'Rounded', value: '8px' },
  round: { label: 'Very rounded', value: '14px' }
};

export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'];
export const EFFORTS = ['low', 'medium', 'high'];

// Matches the defaults at the top of style.css.
export const DEFAULT_APPEARANCE = {
  siteName: 'Recipes',
  favicon: { type: 'emoji', value: '🍲' },
  colors: {
    light: { bg: '#f1f4f2', ink: '#14212a', muted: '#566770', line: '#c9d4d0', accent: '#2447b8', 'on-accent': '#ffffff', tint: '#dde5f6', field: '#ffffff', danger: '#b3261e' },
    dark: { bg: '#0e1519', ink: '#e8efec', muted: '#9aaca8', line: '#2a3a3f', accent: '#8eaaff', 'on-accent': '#0e1519', tint: '#1b2845', field: '#131d22', danger: '#ff8a80' }
  },
  fonts: { heading: 'classic-serif', body: 'system-sans' },
  radius: 'default'
};

const DEFAULTS = { appearance: DEFAULT_APPEARANCE, ai: { model: null, effort: null }, apiKey: null };

const IMAGE_TYPES = [
  { ext: 'png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'ico', test: (b) => b.length > 4 && b.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) },
  { ext: 'webp', test: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' }
];
export const MAX_FAVICON_BYTES = 256 * 1024;

const clone = (v) => JSON.parse(JSON.stringify(v));
const CONTROL = /[\u0000-\u001f\u007f]/;

/* ---------- validation ---------- */

// Takes the appearance sent by the admin page and returns a complete, safe copy.
// `current` supplies the uploaded favicon file when the page keeps it.
export function validateAppearance(input, current = DEFAULT_APPEARANCE) {
  if (!input || typeof input !== 'object') throw new SettingsError('Appearance settings are missing.');
  const out = clone(DEFAULT_APPEARANCE);

  const name = String(input.siteName ?? '').trim();
  if (!name || name.length > 60 || CONTROL.test(name)) throw new SettingsError('The site name must be 1 to 60 characters.');
  out.siteName = name;

  const fav = input.favicon || {};
  if (fav.type === 'emoji') {
    const value = String(fav.value ?? '').trim();
    if (!value || [...value].length > 8 || CONTROL.test(value)) throw new SettingsError('The icon must be an emoji or up to 8 characters.');
    out.favicon = { type: 'emoji', value };
  } else if (fav.type === 'image' && current.favicon?.type === 'image') {
    out.favicon = { ...current.favicon };
  } else {
    throw new SettingsError('Choose an emoji for the icon, or upload an image.');
  }

  for (const scheme of ['light', 'dark']) {
    for (const key of Object.keys(COLORS)) {
      const v = input.colors?.[scheme]?.[key];
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new SettingsError(`"${COLORS[key]}" (${scheme}) must be a colour like #2447b8.`);
      out.colors[scheme][key] = v.toLowerCase();
    }
  }

  for (const which of ['heading', 'body']) {
    const v = input.fonts?.[which];
    if (!Object.hasOwn(FONTS, v)) throw new SettingsError(`Unknown ${which} font.`);
    out.fonts[which] = v;
  }

  if (!Object.hasOwn(RADII, input.radius)) throw new SettingsError('Unknown corner style.');
  out.radius = input.radius;
  return out;
}

export function validateAi(input) {
  const model = input?.model || null;
  const effort = input?.effort || null;
  if (model !== null && !MODELS.includes(model)) throw new SettingsError('Unknown model.');
  if (effort !== null && !EFFORTS.includes(effort)) throw new SettingsError('Unknown effort level.');
  return { model, effort };
}

/* ---------- generated files ---------- */

function vars(obj) {
  return Object.entries(obj).map(([k, v]) => `  --${k}: ${v};`).join('\n');
}

export function renderThemeCss(a) {
  return `/* Generated by the admin page. Changes made here are overwritten on the next save. */

:root {
${vars(a.colors.light)}
  --font-heading: ${FONTS[a.fonts.heading].stack};
  --font-body: ${FONTS[a.fonts.body].stack};
  --radius: ${RADII[a.radius].value};
}

@media (prefers-color-scheme: dark) {
  :root {
${vars(a.colors.dark).replace(/^/gm, '  ')}
  }
}
`;
}

const xmlEscape = (s) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderEmojiFavicon(text) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${xmlEscape(text)}</text></svg>\n`;
}

export function sniffImage(buffer) {
  if (buffer.length > MAX_FAVICON_BYTES) throw new SettingsError(`Icons must be under ${MAX_FAVICON_BYTES / 1024} KB.`, 413);
  const type = IMAGE_TYPES.find((t) => t.test(buffer));
  if (!type) throw new SettingsError('Icons must be PNG, ICO or WebP images.', 415);
  return type.ext;
}

async function writeAtomic(file, data, mode) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, data, { mode });
  await fs.rename(tmp, file);
}

const version = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);

async function writeThemeFiles(a) {
  const dir = config.themeDir;
  let faviconFile;
  let faviconData;
  if (a.favicon.type === 'emoji') {
    faviconFile = 'favicon.svg';
    faviconData = renderEmojiFavicon(a.favicon.value);
    await writeAtomic(path.join(dir, faviconFile), faviconData, 0o644);
  } else {
    faviconFile = a.favicon.file;
    faviconData = await fs.readFile(path.join(dir, faviconFile));
  }
  // Only one favicon at a time, so an old one is never served by mistake
  for (const f of ['favicon.svg', ...IMAGE_TYPES.map((t) => `favicon.${t.ext}`)]) {
    if (f !== faviconFile) await fs.rm(path.join(dir, f), { force: true });
  }

  await writeAtomic(path.join(dir, 'theme.css'), renderThemeCss(a), 0o644);
  const site = { name: a.siteName, favicon: `theme/${faviconFile}?v=${version(faviconData)}` };
  await writeAtomic(path.join(dir, 'site.json'), JSON.stringify(site, null, 2) + '\n', 0o644);
}

/* ---------- loading and saving ---------- */

let current = clone(DEFAULTS);

function merge(saved) {
  const s = clone(DEFAULTS);
  if (saved.appearance) {
    try {
      s.appearance = validateAppearance({ ...DEFAULT_APPEARANCE, ...saved.appearance }, saved.appearance);
    } catch (e) {
      console.error(`settings: ignoring saved appearance (${e.message})`);
    }
  }
  try {
    s.ai = validateAi(saved.ai);
  } catch {
    /* fall back to the server defaults */
  }
  s.apiKey = typeof saved.apiKey === 'string' && saved.apiKey ? saved.apiKey : null;
  return s;
}

// Called once at startup. Missing files are fine: the defaults apply.
export async function loadSettings() {
  try {
    current = merge(JSON.parse(await fs.readFile(config.settingsFile, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`settings: couldn't read ${config.settingsFile}: ${e.message}`);
    current = clone(DEFAULTS);
  }
  try {
    await writeThemeFiles(current.appearance);
  } catch (e) {
    console.error(`settings: couldn't write the theme files in ${config.themeDir}: ${e.message}`);
  }
  return current;
}

let queue = Promise.resolve();
function change(fn) {
  const run = queue.then(async () => {
    const next = clone(current);
    await fn(next);
    await writeAtomic(config.settingsFile, JSON.stringify(next, null, 2) + '\n', 0o600);
    current = next;
    await writeThemeFiles(current.appearance);
  });
  queue = run.catch(() => {});
  return run;
}

export function saveAppearance(input) {
  return change((s) => { s.appearance = validateAppearance(input, s.appearance); });
}

export function saveAi(input) {
  return change((s) => { s.ai = validateAi(input); });
}

export function saveApiKey(key) {
  key = String(key ?? '').trim();
  if (key && !/^[\x21-\x7e]{20,300}$/.test(key)) throw new SettingsError("That doesn't look like an API key.");
  return change((s) => { s.apiKey = key || null; });
}

export async function saveFaviconImage(buffer) {
  const ext = sniffImage(buffer);
  const file = `favicon.${ext}`;
  await writeAtomic(path.join(config.themeDir, file), buffer, 0o644);
  return change((s) => { s.appearance.favicon = { type: 'image', file }; });
}

export function appearance() {
  return clone(current.appearance);
}

// What the Claude import uses. The admin page wins over api.env.
export function aiConfig() {
  return {
    apiKey: current.apiKey || config.apiKey || null,
    model: current.ai.model || config.model,
    effort: current.ai.effort || config.effort
  };
}

// The key itself never leaves the server: the admin page only sees where it came from
// and its last four characters.
export function keyStatus() {
  const key = current.apiKey || config.apiKey;
  if (key) return { set: true, source: current.apiKey ? 'admin' : 'env', last4: key.slice(-4) };
  if (process.env.ANTHROPIC_AUTH_TOKEN) return { set: true, source: 'env', last4: '' };
  return { set: false, source: null, last4: '' };
}

export function aiSettings() {
  return { model: current.ai.model, effort: current.ai.effort, defaults: { model: config.model, effort: config.effort } };
}
