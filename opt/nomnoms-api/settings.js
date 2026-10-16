// Settings changed from the admin page: the site's look, and the Claude key, model and effort.
//
// The source of truth is SETTINGS_FILE (outside the web root, mode 0600, as it may hold the
// API key). Every save also regenerates public files in THEME_DIR, which the static site
// loads directly, so the site keeps its look even when this service is down:
//   theme.css    CSS variables that override the defaults at the top of style.css
//   site.json    { name, favicon } read by app.js
//   favicon.*    an SVG made from the chosen emoji, or the uploaded image
//
// Only checked values ever reach theme.css (hex colours, font keys, a whole-pixel radius),
// which is what keeps the generated CSS safe. Colours start from one of THEMES and can be
// adjusted; `theme` only records which one, for the admin page's label and reset button.

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

// Every theme must pass the CONTRAST pairs at CONTRAST.warn in both modes (the tests check).
// The first theme is the default, and matches the defaults at the top of style.css.
export const THEMES = {
  'sea-glass': {
    label: 'Sea glass',
    colors: {
      light: { bg: '#f1f4f2', ink: '#14212a', muted: '#566770', line: '#c9d4d0', accent: '#2447b8', 'on-accent': '#ffffff', tint: '#dde5f6', field: '#ffffff', danger: '#b3261e' },
      dark: { bg: '#0e1519', ink: '#e8efec', muted: '#9aaca8', line: '#2a3a3f', accent: '#8eaaff', 'on-accent': '#0e1519', tint: '#1b2845', field: '#131d22', danger: '#ff8a80' }
    }
  },
  terracotta: {
    label: 'Terracotta',
    colors: {
      light: { bg: '#f7f1ea', ink: '#2a1d16', muted: '#6b594d', line: '#e0d2c3', accent: '#a8411f', 'on-accent': '#ffffff', tint: '#f6dfd3', field: '#fffdfa', danger: '#a3231b' },
      dark: { bg: '#1a1310', ink: '#f2e8df', muted: '#b8a596', line: '#3a2c24', accent: '#f0956e', 'on-accent': '#1a1310', tint: '#3d2419', field: '#221915', danger: '#ff8a80' }
    }
  },
  sage: {
    label: 'Sage',
    colors: {
      light: { bg: '#f2f4ee', ink: '#1c2419', muted: '#56614f', line: '#cfd8c6', accent: '#3a6435', 'on-accent': '#ffffff', tint: '#dde8d6', field: '#ffffff', danger: '#b3261e' },
      dark: { bg: '#11160f', ink: '#e6ece1', muted: '#a3b09b', line: '#2c3628', accent: '#9fcf8f', 'on-accent': '#11160f', tint: '#22331d', field: '#171d14', danger: '#ff8a80' }
    }
  },
  slate: {
    label: 'Slate',
    colors: {
      light: { bg: '#f5f5f4', ink: '#1c1c1e', muted: '#5c5d63', line: '#d6d6d3', accent: '#3d4f63', 'on-accent': '#ffffff', tint: '#e1e6ec', field: '#ffffff', danger: '#b3261e' },
      dark: { bg: '#141517', ink: '#ececec', muted: '#a3a5ab', line: '#2e3034', accent: '#a9bdd6', 'on-accent': '#141517', tint: '#232b36', field: '#1b1c1f', danger: '#ff8a80' }
    }
  },
  plum: {
    label: 'Plum',
    colors: {
      light: { bg: '#f7f3f6', ink: '#241a24', muted: '#64566a', line: '#ddd0da', accent: '#7a2d6b', 'on-accent': '#ffffff', tint: '#f0dcea', field: '#ffffff', danger: '#b3261e' },
      dark: { bg: '#171117', ink: '#f0e8ef', muted: '#b3a3b1', line: '#362a35', accent: '#e3a1d4', 'on-accent': '#171117', tint: '#3a2236', field: '#1e171e', danger: '#ff8a80' }
    }
  },
  'high-contrast': {
    label: 'High contrast',
    colors: {
      light: { bg: '#ffffff', ink: '#000000', muted: '#3d3d3d', line: '#767676', accent: '#0033cc', 'on-accent': '#ffffff', tint: '#e0e8ff', field: '#ffffff', danger: '#b00020' },
      dark: { bg: '#000000', ink: '#ffffff', muted: '#cfcfcf', line: '#8a8a8a', accent: '#9db8ff', 'on-accent': '#000000', tint: '#1a2850', field: '#0a0a0a', danger: '#ff8a80' }
    }
  }
};

// Colour pairs that must stay readable. Below `warn` the admin page shows a warning;
// below `min` the colours can't be saved. Ratios are WCAG 2 contrast ratios.
export const CONTRAST = {
  warn: 4.5,
  min: 3,
  pairs: [
    { fg: 'ink', bg: 'bg', label: 'Text on the page' },
    { fg: 'ink', bg: 'field', label: 'Text in input fields' },
    { fg: 'muted', bg: 'bg', label: 'Secondary text on the page' },
    { fg: 'accent', bg: 'bg', label: 'Links and outlined buttons' },
    { fg: 'on-accent', bg: 'accent', label: 'Text on filled buttons' },
    { fg: 'accent', bg: 'tint', label: 'Accent on highlights' },
    { fg: 'danger', bg: 'bg', label: 'Error messages' }
  ]
};

// The same formula is in app.js, for the admin page's warnings
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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

// Corner rounding in whole pixels
export const RADIUS = { min: 0, max: 24 };
// Settings saved before the slider used these named corner styles
const LEGACY_RADII = { square: 0, subtle: 4, default: 8, round: 14 };

export const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
export const EFFORTS = ['low', 'medium', 'high'];

// Matches the defaults at the top of style.css.
export const DEFAULT_APPEARANCE = {
  siteName: 'Recipes',
  favicon: { type: 'emoji', value: '🍲' },
  theme: 'sea-glass',
  colors: structuredClone(THEMES['sea-glass'].colors),
  fonts: { heading: 'classic-serif', body: 'system-sans' },
  radius: 8
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
// `current` supplies the uploaded favicon file when the page keeps it. Settings loaded from
// disk skip the contrast check, so colours saved before it existed still load.
export function validateAppearance(input, current = DEFAULT_APPEARANCE, { checkContrast = true } = {}) {
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
    if (!checkContrast) continue;
    for (const p of CONTRAST.pairs) {
      const ratio = contrastRatio(out.colors[scheme][p.fg], out.colors[scheme][p.bg]);
      if (ratio < CONTRAST.min) {
        throw new SettingsError(`${p.label} in ${scheme} mode is too hard to read (${ratio.toFixed(1)}:1, needs at least ${CONTRAST.min}:1).`);
      }
    }
  }

  if (!Object.hasOwn(THEMES, input.theme)) throw new SettingsError('Unknown colour theme.');
  out.theme = input.theme;

  for (const which of ['heading', 'body']) {
    const v = input.fonts?.[which];
    if (!Object.hasOwn(FONTS, v)) throw new SettingsError(`Unknown ${which} font.`);
    out.fonts[which] = v;
  }

  const r = input.radius;
  if (!Number.isInteger(r) || r < RADIUS.min || r > RADIUS.max) throw new SettingsError(`Corner rounding must be a whole number from ${RADIUS.min} to ${RADIUS.max}.`);
  out.radius = r;
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
  --radius: ${a.radius}px;
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
    if (Object.hasOwn(LEGACY_RADII, saved.appearance.radius)) saved.appearance.radius = LEGACY_RADII[saved.appearance.radius];
    try {
      s.appearance = validateAppearance({ ...DEFAULT_APPEARANCE, ...saved.appearance }, saved.appearance, { checkContrast: false });
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
// Haiku models have no server-side fallbacks, so they're off for them whatever AI_FALLBACKS says.
export function aiConfig() {
  const model = current.ai.model || config.model;
  return {
    apiKey: current.apiKey || config.apiKey || null,
    model,
    effort: current.ai.effort || config.effort,
    fallbacks: config.aiFallbacks && !model.startsWith('claude-haiku')
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
