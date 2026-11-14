// Settings changed from the admin page: the site's look, and the Claude key, model and effort.
//
// The source of truth is SETTINGS_FILE (outside the web root, mode 0600, as it may hold the
// API key). Every save also regenerates public files in THEME_DIR, which the static site
// loads directly, so the site keeps its look even when this service is down:
//   theme.css    CSS variables that override the defaults at the top of style.css
//   site.json    { name, favicon, thumbnails } read by app.js
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
  line: 'Hairlines between rows',
  'line-strong': 'Borders of fields and boxes',
  accent: 'Accent (buttons, links)',
  'on-accent': 'Text on accent',
  highlight: 'Highlighter (active things)',
  'on-highlight': 'Text on the highlighter',
  tint: 'Wash (photo placeholders)',
  field: 'Input fields',
  danger: 'Errors'
};

// Every theme must pass the CONTRAST pairs at CONTRAST.warn in both modes (the tests check).
// The first theme is the default, and matches the defaults at the top of style.css.
export const THEMES = {
  paper: {
    label: 'Paper',
    colors: {
      light: { bg: '#f5f1e8', ink: '#1c1a15', muted: '#5d574b', line: '#d9d2c2', accent: '#b23218', 'on-accent': '#fcfaf4', tint: '#efe1d3', field: '#fcfaf4', danger: '#7e1d12', 'line-strong': '#857d6b', highlight: '#f3cd4f', 'on-highlight': '#1c1a15' },
      dark: { bg: '#171612', ink: '#ece7db', muted: '#a69f8f', line: '#35322b', accent: '#ee7b5e', 'on-accent': '#171612', tint: '#3b2720', field: '#201e19', danger: '#ff9d8c', 'line-strong': '#736c5e', highlight: '#e3b53c', 'on-highlight': '#171612' }
    }
  },
  'sea-glass': {
    label: 'Sea glass',
    colors: {
      light: { bg: '#eef2ef', ink: '#122027', muted: '#4f6269', line: '#cad5d1', 'line-strong': '#7b8788', accent: '#1d4f9c', 'on-accent': '#f8faf8', highlight: '#a8dcc5', 'on-highlight': '#122027', tint: '#dce5ef', field: '#f8faf8', danger: '#9e2b20' },
      dark: { bg: '#0f1517', ink: '#e3ebe8', muted: '#97a9a5', line: '#253337', 'line-strong': '#626e70', accent: '#8fb0f0', 'on-accent': '#0f1517', highlight: '#72c2a4', 'on-highlight': '#0f1517', tint: '#1a2740', field: '#151d20', danger: '#f59a8c' }
    }
  },
  terracotta: {
    label: 'Terracotta',
    colors: {
      light: { bg: '#f3ebe2', ink: '#2a1c15', muted: '#68554a', line: '#dfcfbf', 'line-strong': '#8f8074', accent: '#99401f', 'on-accent': '#fbf6f0', highlight: '#cdd38c', 'on-highlight': '#2a1c15', tint: '#f0dccf', field: '#fbf6f0', danger: '#7c1a16' },
      dark: { bg: '#1a130f', ink: '#f0e5da', muted: '#b6a293', line: '#3a2b22', 'line-strong': '#76685f', accent: '#eb9570', 'on-accent': '#1a130f', highlight: '#b9c06c', 'on-highlight': '#1a130f', tint: '#3d2418', field: '#221913', danger: '#ffa08e' }
    }
  },
  sage: {
    label: 'Sage',
    colors: {
      light: { bg: '#eff2ea', ink: '#1a2318', muted: '#535f4c', line: '#ced7c5', 'line-strong': '#7f8879', accent: '#335d30', 'on-accent': '#f9faf6', highlight: '#cdbdeb', 'on-highlight': '#1a2318', tint: '#dce7d4', field: '#f9faf6', danger: '#9c2f1e' },
      dark: { bg: '#11160f', ink: '#e5ebdf', muted: '#a2af9a', line: '#2b3527', 'line-strong': '#676f62', accent: '#9fcf8f', 'on-accent': '#11160f', highlight: '#a990d6', 'on-highlight': '#11160f', tint: '#22331d', field: '#171d14', danger: '#ff9d88' }
    }
  },
  slate: {
    label: 'Slate',
    colors: {
      light: { bg: '#f2f2f0', ink: '#1b1c1e', muted: '#5a5b61', line: '#d4d4d1', 'line-strong': '#868786', accent: '#36495e', 'on-accent': '#fafaf9', highlight: '#e2d652', 'on-highlight': '#1b1c1e', tint: '#dfe4ea', field: '#fafaf9', danger: '#9d2a1f' },
      dark: { bg: '#141517', ink: '#ebebea', muted: '#a2a4aa', line: '#2d2f33', 'line-strong': '#6c6d6f', accent: '#a9bdd6', 'on-accent': '#141517', highlight: '#d6cd5c', 'on-highlight': '#141517', tint: '#232b36', field: '#1b1c1f', danger: '#ff9a8a' }
    }
  },
  plum: {
    label: 'Plum',
    colors: {
      light: { bg: '#f5f0f2', ink: '#241923', muted: '#625467', line: '#dccfd8', 'line-strong': '#8f838c', accent: '#76295f', 'on-accent': '#fcf9fa', highlight: '#ecc56a', 'on-highlight': '#241923', tint: '#efdbe7', field: '#fcf9fa', danger: '#9c2a1a' },
      dark: { bg: '#171116', ink: '#efe7ee', muted: '#b2a2b0', line: '#352934', 'line-strong': '#716670', accent: '#e3a1d4', 'on-accent': '#171116', highlight: '#d9ae4c', 'on-highlight': '#171116', tint: '#3a2236', field: '#1e171d', danger: '#ffa08a' }
    }
  },
  'high-contrast': {
    label: 'High contrast',
    colors: {
      light: { bg: '#ffffff', ink: '#000000', muted: '#3d3d3d', line: '#767676', 'line-strong': '#767676', accent: '#0033cc', 'on-accent': '#ffffff', highlight: '#ffd400', 'on-highlight': '#000000', tint: '#e0e8ff', field: '#ffffff', danger: '#b00020' },
      dark: { bg: '#000000', ink: '#ffffff', muted: '#cfcfcf', line: '#8a8a8a', 'line-strong': '#8a8a8a', accent: '#9db8ff', 'on-accent': '#000000', highlight: '#ffd400', 'on-highlight': '#000000', tint: '#1a2850', field: '#000000', danger: '#ff8a80' }
    }
  },
  // For colour blindness: accent and errors stay apart in hue and lightness for the types in `note` (the tests check)
  'blue-orange': {
    label: 'Blue & orange',
    note: 'Protanopia, deuteranopia',
    colors: {
      light: { bg: '#f1f3f6', ink: '#15202b', muted: '#535e69', line: '#cbd3dc', 'line-strong': '#7f8892', accent: '#0a4f9e', 'on-accent': '#f9fafc', highlight: '#f3cd4f', 'on-highlight': '#15202b', tint: '#dbe6f4', field: '#f9fafc', danger: '#b04000' },
      dark: { bg: '#0f141a', ink: '#e8edf2', muted: '#9daab7', line: '#2a343f', 'line-strong': '#636c75', accent: '#a8d1ff', 'on-accent': '#0f141a', highlight: '#e3b53c', 'on-highlight': '#0f141a', tint: '#1a2c44', field: '#151b22', danger: '#f08a3c' }
    }
  },
  'teal-crimson': {
    label: 'Teal & crimson',
    note: 'Tritanopia',
    colors: {
      light: { bg: '#eff3f2', ink: '#132121', muted: '#516363', line: '#c8d5d4', 'line-strong': '#7c8989', accent: '#006b67', 'on-accent': '#f8fafa', highlight: '#f3cd4f', 'on-highlight': '#132121', tint: '#d2e9e7', field: '#f8fafa', danger: '#94002e' },
      dark: { bg: '#0e1616', ink: '#e5efee', muted: '#9cafad', line: '#273939', 'line-strong': '#5e6e6d', accent: '#5fd4cf', 'on-accent': '#0e1616', highlight: '#e3b53c', 'on-highlight': '#0e1616', tint: '#173434', field: '#131d1d', danger: '#ff7a9c' }
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
    { fg: 'on-highlight', bg: 'highlight', label: 'Text on the highlighter' },
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

// The first two are served from the site's own fonts/ folder (style.css declares them);
// the rest are system font stacks, so nothing is downloaded from anywhere else.
export const FONTS = {
  besley: { label: 'Besley (cookbook serif)', stack: 'Besley, "Clarendon", "Century Schoolbook", Georgia, serif' },
  'schibsted-grotesk': { label: 'Schibsted Grotesk', stack: '"Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif' },
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
  siteName: 'Nammet Recipes',
  favicon: { type: 'emoji', value: 'N' },
  theme: 'paper',
  colors: structuredClone(THEMES.paper.colors),
  fonts: { heading: 'besley', body: 'schibsted-grotesk' },
  radius: 2,
  // Recipe photos on the home page's list
  thumbnails: false
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

  out.thumbnails = input.thumbnails === true;
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

// app.js has a copy (renderLookCss) for demo mode's in-browser looks; keep them alike
export function renderThemeCss(a) {
  return `/* Generated by the admin page. Changes made here are overwritten on the next save. */

:root {
${vars(a.colors.light)}
  --font-heading: ${FONTS[a.fonts.heading].stack};
  --font-body: ${FONTS[a.fonts.body].stack};
  --radius: ${a.radius}px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${vars(a.colors.dark).replace(/^/gm, '  ')}
  }
}

:root[data-theme="dark"] {
${vars(a.colors.dark)}
}
`;
}

const xmlEscape = (s) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

// One or two plain letters or digits become a tile in the accent colour; anything else
// (an emoji) is drawn as it is.
export function renderEmojiFavicon(text, colors = THEMES.paper.colors.light) {
  if (/^[A-Za-z0-9]{1,2}$/.test(text)) {
    const size = text.length === 1 ? 72 : 52;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="6" fill="${colors.accent}"/><text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-family="Besley, Clarendon, 'Century Schoolbook', Georgia, serif" font-weight="800" font-size="${size}" fill="${colors['on-accent']}">${text}</text></svg>\n`;
  }
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
    faviconData = renderEmojiFavicon(a.favicon.value, a.colors.light);
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
  const site = { name: a.siteName, favicon: `theme/${faviconFile}?v=${version(faviconData)}`, thumbnails: a.thumbnails };
  await writeAtomic(path.join(dir, 'site.json'), JSON.stringify(site, null, 2) + '\n', 0o644);
}

/* ---------- loading and saving ---------- */

let current = clone(DEFAULTS);

function merge(saved) {
  const s = clone(DEFAULTS);
  if (saved.appearance) {
    if (Object.hasOwn(LEGACY_RADII, saved.appearance.radius)) saved.appearance.radius = LEGACY_RADII[saved.appearance.radius];
    // Colours added since the settings were saved come from their theme
    const base = THEMES[saved.appearance.theme] || THEMES[DEFAULT_APPEARANCE.theme];
    if (saved.appearance.colors && typeof saved.appearance.colors === 'object') {
      for (const scheme of ['light', 'dark']) {
        saved.appearance.colors[scheme] = { ...base.colors[scheme], ...saved.appearance.colors[scheme] };
      }
    }
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
