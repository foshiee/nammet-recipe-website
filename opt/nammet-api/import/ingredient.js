// Turns an ingredient line such as "1 ½ cups plain flour, sifted" into
// { amount: "1 1/2", unit: "cup", name: "plain flour", note: "sifted" }.
// Used for schema.org recipes, which only give ingredients as plain strings.

// Units the site converts, with the spellings it accepts (mirrors ALIASES in app.js).
const UNITS = {
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tbls: 'tbsp',
  cup: 'cup', cups: 'cup',
  'fl oz': 'fl oz', floz: 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  oz: 'oz', ounce: 'oz', ounces: 'oz', ozs: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g', gms: 'g', gr: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kgs: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', mls: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l'
};

// Units the site shows as written. Kept as the author wrote them.
const OTHER_UNITS = [
  'cloves?', 'cans?', 'tins?', 'jars?', 'packets?', 'packages?', 'pkgs?', 'bunch(?:es)?', 'handfuls?',
  'pinch(?:es)?', 'dash(?:es)?', 'slices?', 'sprigs?', 'sticks?', 'heads?', 'pieces?', 'stalks?', 'sheets?',
  'drops?', 'knobs?', 'fillets?', 'rashers?', 'bottles?', 'bags?', 'boxes?', 'cubes?', 'leaves', 'ears?',
  'quarts?', 'qts?', 'pints?', 'pts?', 'gallons?'
];

const PRICE_RE = /^[$£€]\s?\d+(?:[.,]\d+)?$/; // per-ingredient costs some sites add, such as "$0.20"

const UNIT_RE = new RegExp(
  '^(' +
    Object.keys(UNITS).sort((a, b) => b.length - a.length).map((u) => u.replace(' ', '\\s+')).join('|') +
    '|' + OTHER_UNITS.join('|') +
  ')\\.?(?=[\\s,)]|$)',
  'i'
);

const UNICODE_FRACTIONS = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
  '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
};

// "1½" -> "1 1/2", "½" -> "1/2", "1⁄2" (fraction slash) -> "1/2"
export function normalizeFractions(s) {
  return String(s)
    .replace(/⁄/g, '/')
    .replace(/(\d)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (m, d, f) => `${d} ${UNICODE_FRACTIONS[f]}`)
    .replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (f) => UNICODE_FRACTIONS[f]);
}

const NUM = '(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:[.,]\\d+)?)';
const AMOUNT_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|to|or)\\s*(${NUM}))?\\s*`, 'i');

// "1.5" -> 1.5, "1 1/2" -> "1 1/2" (the site parses both)
export function toAmount(s) {
  s = String(s).trim().replace(/(\d),(\d)/, '$1.$2');
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(\d+\s+)?\d+\/\d+$/.test(s)) return s.replace(/\s+/, ' ');
  return null;
}

export function canonicalUnit(u) {
  if (!u) return '';
  const key = String(u).trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
  return UNITS[key] || String(u).trim();
}

export function parseIngredient(line) {
  let s = normalizeFractions(String(line).replace(/\s+/g, ' ').trim());
  const out = { name: s };
  if (!s) return out;

  const notes = [];
  let amount = null;
  let unit = '';

  const m = s.match(AMOUNT_RE);
  if (m) {
    amount = toAmount(m[1]);
    if (m[2]) notes.push(`${m[1]}–${m[2]} in the original`);
    s = s.slice(m[0].length);

    // "2 (400 g) cans tomatoes": keep the size as a note
    const paren = s.match(/^\(([^)]*)\)\s*/);
    if (paren) {
      notes.push(paren[1]);
      s = s.slice(paren[0].length);
    }

    const u = s.match(UNIT_RE);
    if (u) {
      unit = canonicalUnit(u[1]);
      s = s.slice(u[0].length).trim();
      // "1/2 lb (225g) chicken livers": the metric equivalent becomes a note
      const after = s.match(/^\(([^)]*)\)\s*/);
      if (after) {
        notes.push(after[1]);
        s = s.slice(after[0].length);
      }
    }
    s = s.replace(/^of\s+/i, '');
  }

  // "salt, to taste" / "salt to taste"
  if (amount === null && /,?\s*to taste$/i.test(s)) {
    s = s.replace(/,?\s*to taste$/i, '');
    unit = 'to taste';
  }

  // First comma or trailing parenthesis splits the name from the note
  let name = s;
  const comma = name.indexOf(',');
  if (comma > 0) {
    notes.push(name.slice(comma + 1).trim());
    name = name.slice(0, comma);
  }
  const trailing = name.match(/\s*\(([^)]*)\)\s*$/);
  if (trailing && trailing.index > 0) {
    notes.push(trailing[1]);
    name = name.slice(0, trailing.index);
  }

  name = name.trim();
  if (!name) return { name: String(line).trim() };

  const item = {};
  if (amount !== null) item.amount = amount;
  else if (unit === 'to taste') item.amount = null;
  if (unit) item.unit = unit;
  item.name = name;
  const note = notes.map((n) => n.trim()).filter((n) => n && !PRICE_RE.test(n)).join('; ');
  if (note) item.note = note;
  return item;
}
