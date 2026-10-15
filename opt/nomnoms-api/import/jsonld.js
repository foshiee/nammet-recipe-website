// Reads schema.org Recipe data, which most recipe websites embed in
// <script type="application/ld+json"> for search engines. No LLM needed.

import { parseIngredient } from './ingredient.js';
import { cleanText, isoDurationSeconds, humanDuration, stepTimer } from './text.js';

const SCRIPT_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

const isRecipe = (o) => {
  const t = o && o['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
};

// Depth-first search through @graph, arrays and nested objects
export function findRecipeObject(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 6) return null;
  if (Array.isArray(data)) {
    for (const x of data) {
      const r = findRecipeObject(x, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isRecipe(data)) return data;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const r = findRecipeObject(data[key], depth + 1);
    if (r) return r;
  }
  return null;
}

export function extractJsonLdRecipe(html) {
  for (const m of String(html).matchAll(SCRIPT_RE)) {
    const body = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/^<!--|-->$/g, '');
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      try {
        data = JSON.parse(body.replace(/[\u0000-\u001f]+/g, ' ')); // raw newlines inside strings
      } catch {
        continue;
      }
    }
    const recipe = findRecipeObject(data);
    if (recipe) return recipe;
  }
  return null;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function servingsFrom(y) {
  for (const v of asList(y)) {
    const m = String(v).match(/\d+/);
    if (m && Number(m[0]) > 0) return Number(m[0]);
  }
  return undefined;
}

function tagsFrom(r) {
  // Category and cuisine first: keywords are often SEO filler, so they only fill the remaining slots
  const raw = [...asList(r.recipeCategory), ...asList(r.recipeCuisine), ...asList(r.keywords)]
    .flatMap((k) => String(k).split(','));
  const tags = raw.map((t) => cleanText(t).toLowerCase()).filter((t) => t && t.length <= 30);
  return [...new Set(tags)].slice(0, 6);
}

function stepsFrom(instructions) {
  const steps = [];
  const add = (text, title) => {
    text = cleanText(text);
    if (!text) return;
    const step = {};
    if (title) step.title = title;
    step.text = text;
    const timer = stepTimer(text);
    if (timer) step.timer = timer;
    steps.push(step.title || step.timer ? step : text);
  };

  const walk = (node, sectionTitle) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      // Some sites put the whole method in one string, one step per line
      const lines = node.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
      lines.forEach((l, i) => add(l, i === 0 ? sectionTitle : ''));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, i === 0 ? sectionTitle : ''));
      return;
    }
    const type = first(node['@type']);
    if (type === 'HowToSection') {
      walk(node.itemListElement, cleanText(node.name) || sectionTitle);
      return;
    }
    const text = node.text || node.description || node.name || '';
    const name = cleanText(node.name);
    // Many sites fill a step's name with a copy (or truncated copy) of its text; only keep real headings
    const body = cleanText(text);
    const isCopy = name === body || (name.length >= 25 && body.startsWith(name.replace(/(\.\.\.|…)$/, '')));
    const title = sectionTitle || (name && name.length < 60 && !isCopy ? name : '');
    add(text, title);
  };

  walk(instructions, '');
  return steps;
}

// schema.org Recipe -> our recipe format
export function mapJsonLdRecipe(r, pageUrl) {
  const out = {};
  const title = cleanText(first(r.name) || first(r.headline));
  if (title) out.title = title;
  const description = cleanText(first(r.description));
  if (description) out.description = description;
  const servings = servingsFrom(r.recipeYield);
  if (servings) out.servings = servings;

  const total = isoDurationSeconds(first(r.totalTime)) ||
    isoDurationSeconds(first(r.prepTime)) + isoDurationSeconds(first(r.cookTime));
  if (total) out.time = humanDuration(total);

  const tags = tagsFrom(r);
  if (tags.length) out.tags = tags;

  const source = pageUrl || (typeof r.url === 'string' ? r.url : '');
  if (source) out.source = source;

  out.ingredients = asList(r.recipeIngredient || r.ingredients)
    .map((l) => cleanText(l))
    .filter(Boolean)
    .map(parseIngredient);
  out.steps = stepsFrom(r.recipeInstructions);
  return out;
}
