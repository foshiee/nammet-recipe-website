// Checks a recipe against docs/recipe-format.md and returns a tidied copy.
// errors   = the site would show the recipe wrongly, so saving is refused
// warnings = worth a look, but the recipe works

import { normalizeFractions, toAmount } from './ingredient.js';

const KNOWN = ['title', 'description', 'servings', 'time', 'tags', 'source', 'image', 'ingredients', 'steps', 'notes'];

// A photo in the site's photos folder. Outside addresses aren't allowed, so pages never load
// anything from other sites. The same pattern is in app.js.
export const IMAGE_RE = /^photos\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:jpe?g|png|webp)$/;

const QTY_RE = /\b\d+(?:[.,/]\d+)?\s*(?:g|kg|ml|l|oz|lbs?|cups?|tbsp|tsp|tablespoons?|teaspoons?|grams?|pounds?|ounces?|litres?|liters?)\b/i;

const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function validateRecipe(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { recipe: null, errors: ['The recipe must be a JSON object.'], warnings };
  }

  const r = {};

  const title = str(raw.title);
  if (title) r.title = title;
  else warnings.push('There is no title, so the file name will be shown instead.');

  for (const key of ['description', 'time', 'source']) {
    const v = str(raw[key]);
    if (v) r[key] = v;
  }

  if (raw.image !== undefined && raw.image !== null && raw.image !== '') {
    if (typeof raw.image === 'string' && IMAGE_RE.test(raw.image.trim())) r.image = raw.image.trim();
    else warnings.push(`The image "${str(raw.image) || '(not text)'}" isn't a photo stored on this site, so it was left out. Add one in the Photo section.`);
  }

  if (raw.servings !== undefined && raw.servings !== null && raw.servings !== '') {
    const n = Number(raw.servings);
    if (n > 0 && isFinite(n)) {
      r.servings = Math.max(1, Math.round(n));
      if (r.servings !== n) warnings.push(`Servings was ${raw.servings}; rounded to ${r.servings}.`);
    } else {
      warnings.push(`Servings "${raw.servings}" isn't a number, so it will default to 4.`);
    }
  } else {
    warnings.push('Servings is missing, so it will default to 4. Amounts scale from this number.');
  }

  if (raw.tags !== undefined) {
    if (Array.isArray(raw.tags)) {
      const tags = [...new Set(raw.tags.map((t) => str(t).toLowerCase()).filter(Boolean))];
      if (tags.length) r.tags = tags;
    } else {
      errors.push('"tags" must be a list of strings.');
    }
  }

  // Ingredients
  const fixItem = (it, where) => {
    if (typeof it === 'string') {
      const s = it.trim();
      if (!s) errors.push(`${where} is empty.`);
      return s;
    }
    if (!it || typeof it !== 'object') {
      errors.push(`${where} must be text or an object.`);
      return null;
    }
    const out = {};
    if (it.amount === null) out.amount = null;
    else if (it.amount !== undefined && it.amount !== '') {
      if (typeof it.amount === 'number' && isFinite(it.amount)) out.amount = it.amount;
      else {
        const a = toAmount(normalizeFractions(str(it.amount)));
        if (a === null) errors.push(`${where}: amount "${it.amount}" can't be read. Use a number such as 1.5 or a fraction such as "1 1/2".`);
        else out.amount = a;
      }
    }
    const unit = str(it.unit);
    if (unit) out.unit = unit;
    const name = str(it.name);
    if (!name) errors.push(`${where} has no name.`);
    out.name = name;
    const note = str(it.note);
    if (note) out.note = note;
    return out;
  };

  let count = 0;
  if (raw.ingredients !== undefined) {
    if (!Array.isArray(raw.ingredients)) errors.push('"ingredients" must be a list.');
    else {
      r.ingredients = raw.ingredients.map((e, i) => {
        if (e && typeof e === 'object' && Array.isArray(e.items)) {
          const label = `Ingredient group "${str(e.group) || i + 1}"`;
          const items = e.items.map((it, j) => fixItem(it, `${label}, item ${j + 1}`)).filter((x) => x !== null);
          count += items.length;
          const g = {};
          if (str(e.group)) g.group = str(e.group);
          g.items = items;
          return g;
        }
        count++;
        return fixItem(e, `Ingredient ${i + 1}`);
      }).filter((x) => x !== null);
    }
  }

  // Steps
  if (raw.steps !== undefined) {
    if (!Array.isArray(raw.steps)) errors.push('"steps" must be a list.');
    else {
      r.steps = raw.steps.map((s, i) => {
        if (typeof s === 'string') {
          if (!s.trim()) errors.push(`Step ${i + 1} is empty.`);
          return s.trim();
        }
        if (!s || typeof s !== 'object') {
          errors.push(`Step ${i + 1} must be text or an object.`);
          return '';
        }
        const out = {};
        if (str(s.title)) out.title = str(s.title);
        out.text = str(s.text);
        if (!out.text) errors.push(`Step ${i + 1} has no text.`);
        if (s.timer !== undefined && s.timer !== null && s.timer !== 0) {
          const t = Number(s.timer);
          if (t > 0 && isFinite(t)) out.timer = Math.round(t);
          else errors.push(`Step ${i + 1}: timer must be a number of seconds.`);
        }
        return out.title || out.timer ? out : out.text;
      });
    }
  }

  // Notes
  if (raw.notes !== undefined && raw.notes !== null) {
    const notes = (Array.isArray(raw.notes) ? raw.notes : [raw.notes]).map(str).filter(Boolean);
    if (notes.length) r.notes = notes;
  }

  if (!count && !(r.steps && r.steps.length)) errors.push('The recipe has no ingredients and no steps.');
  else {
    if (!count) warnings.push('The recipe has no ingredients.');
    if (!(r.steps && r.steps.length)) warnings.push('The recipe has no steps.');
  }

  // Quantities in free text don't scale with servings
  (r.steps || []).forEach((s, i) => {
    const m = (typeof s === 'string' ? s : s.text).match(QTY_RE);
    if (m) warnings.push(`Step ${i + 1} mentions "${m[0]}". Step text doesn't scale with servings.`);
  });
  (r.notes || []).forEach((n, i) => {
    const m = n.match(QTY_RE);
    if (m) warnings.push(`Note ${i + 1} mentions "${m[0]}". Notes don't scale with servings.`);
  });

  // Same field order as the docs; fields the site ignores are kept at the end, as the format allows
  const ordered = {};
  for (const k of KNOWN) if (r[k] !== undefined) ordered[k] = r[k];
  for (const [k, v] of Object.entries(raw)) if (!KNOWN.includes(k)) ordered[k] = v;

  return { recipe: ordered, errors, warnings };
}
