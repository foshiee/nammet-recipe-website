// Run with: npm test   (no network or API key needed)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseIngredient } from '../import/ingredient.js';
import { extractJsonLdRecipe, imageFrom, mapJsonLdRecipe, pageImage } from '../import/jsonld.js';
import { validateRecipe } from '../import/validate.js';
import { stepTimer, htmlToText } from '../import/text.js';
import { isPublicAddress, fetchUrl } from '../import/fetch-url.js';
import { importFile } from '../import/index.js';
import { slugify, checkSlug, saveRecipe } from '../save.js';
import { hashPassword, verifyPassword } from '../auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleFile = path.resolve(here, '../../../docs/example-recipe.json');

test('ingredient lines', () => {
  assert.deepEqual(parseIngredient('1 ½ cups plain flour, sifted'), { amount: '1 1/2', unit: 'cup', name: 'plain flour', note: 'sifted' });
  assert.deepEqual(parseIngredient('200g butter'), { amount: 200, unit: 'g', name: 'butter' });
  assert.deepEqual(parseIngredient('2 (400 g) cans chopped tomatoes'), { amount: 2, unit: 'cans', name: 'chopped tomatoes', note: '400 g' });
  assert.deepEqual(parseIngredient('3-4 garlic cloves, minced'), { amount: 3, name: 'garlic cloves', note: '3–4 in the original; minced' });
  assert.deepEqual(parseIngredient('Salt, to taste'), { amount: null, unit: 'to taste', name: 'Salt' });
  assert.deepEqual(parseIngredient('2 Tablespoons olive oil'), { amount: 2, unit: 'tbsp', name: 'olive oil' });
  assert.deepEqual(parseIngredient('1 large egg'), { amount: 1, name: 'large egg' });
  assert.deepEqual(parseIngredient('fresh basil'), { name: 'fresh basil' });
  assert.deepEqual(parseIngredient('1/2 tsp. salt'), { amount: '1/2', unit: 'tsp', name: 'salt' });
  assert.deepEqual(parseIngredient('1/2 pound (225g) chicken livers'), { amount: '1/2', unit: 'lb', name: 'chicken livers', note: '225g' });
  assert.deepEqual(parseIngredient('2 tsp smoked paprika ($0.20)'), { amount: 2, unit: 'tsp', name: 'smoked paprika' });
  assert.deepEqual(parseIngredient('1 quart chicken stock'), { amount: 1, unit: 'quart', name: 'chicken stock' });
});

test('step timers', () => {
  assert.equal(stepTimer('Bake for 25-30 minutes until golden.'), 1500);
  assert.equal(stepTimer('Simmer for 1 hour.'), 3600);
  assert.equal(stepTimer('Fry for 2 minutes, then rest 5 minutes.'), 0);
  assert.equal(stepTimer('Stir well.'), 0);
});

const PAGE = `<!doctype html><html><head><title>x</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],
"name":"Lemon &amp; Herb Chicken","description":"<p>Bright and quick.</p>","recipeYield":["4","4 servings"],
"totalTime":"PT1H15M","keywords":"chicken, lemon, easy","recipeCategory":"Dinner",
"recipeIngredient":["4 chicken thighs","2 tbsp olive oil","1 lemon, zested"],
"recipeInstructions":[{"@type":"HowToSection","name":"Marinate","itemListElement":[{"@type":"HowToStep","text":"Mix the oil and lemon."},{"@type":"HowToStep","text":"Leave for 30 minutes."}]},
{"@type":"HowToStep","name":"Roast","text":"Roast at 200°C for 40 minutes."}]}]}</script></head><body>hi</body></html>`;

test('schema.org JSON-LD page', () => {
  const ld = extractJsonLdRecipe(PAGE);
  assert.ok(ld);
  const r = mapJsonLdRecipe(ld, 'https://example.com/chicken');
  assert.equal(r.title, 'Lemon & Herb Chicken');
  assert.equal(r.description, 'Bright and quick.');
  assert.equal(r.servings, 4);
  assert.equal(r.time, '1 hr 15 min');
  assert.deepEqual(r.tags, ['dinner', 'chicken', 'lemon', 'easy']);
  assert.equal(r.source, 'https://example.com/chicken');
  assert.equal(r.ingredients.length, 3);
  assert.deepEqual(r.steps[0], { title: 'Marinate', text: 'Mix the oil and lemon.' });
  assert.deepEqual(r.steps[1], { text: 'Leave for 30 minutes.', timer: 1800 });
  assert.deepEqual(r.steps[2], { title: 'Roast', text: 'Roast at 200°C for 40 minutes.', timer: 2400 });
  assert.deepEqual(validateRecipe(r).errors, []);
});

test('recipe photos from web pages', () => {
  assert.equal(imageFrom('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(imageFrom(['https://example.com/1x1.jpg', 'https://example.com/16x9.jpg']), 'https://example.com/1x1.jpg');
  assert.equal(imageFrom({ '@type': 'ImageObject', url: 'https://example.com/b.jpg', width: 1200 }), 'https://example.com/b.jpg');
  assert.equal(imageFrom([{ '@type': 'ImageObject', contentUrl: '/c.jpg' }]), '/c.jpg');
  assert.equal(imageFrom([[{ url: '' }], { url: 'https://example.com/d.jpg' }]), 'https://example.com/d.jpg');
  assert.equal(imageFrom({ '@id': '#primaryimage' }), '');
  assert.equal(imageFrom(undefined), '');

  assert.equal(pageImage('<head><meta property="og:image" content="https://example.com/og.jpg?a=1&amp;b=2"></head>'), 'https://example.com/og.jpg?a=1&b=2');
  assert.equal(pageImage("<meta content='/tw.png' name='twitter:image'>"), '/tw.png');
  assert.equal(pageImage('<meta property="og:image:width" content="1200">'), '');
});

test('recipe image field', () => {
  const base = { title: 'x', steps: ['Cook.'] };
  const ok = validateRecipe({ ...base, image: 'photos/x-0123456789.jpg', author: 'me' });
  assert.equal(ok.recipe.image, 'photos/x-0123456789.jpg');
  assert.deepEqual(Object.keys(ok.recipe), ['title', 'image', 'steps', 'author']);
  for (const image of ['https://example.com/x.jpg', 'photos/../users.json', 'photos/a/b.jpg', '/photos/x.jpg', 'photos/x.svg', 'photos/.hidden.jpg', 42]) {
    const v = validateRecipe({ ...base, image });
    assert.equal(v.recipe.image, undefined, String(image));
    assert.deepEqual(v.errors, []);
    assert.ok(v.warnings.some((w) => w.includes("isn't a photo stored on this site")), String(image));
  }
});

test('html to text', () => {
  assert.equal(htmlToText('<p>One</p><script>x()</script><ul><li>a</li><li>b &amp; c</li></ul>'), 'One\n\n• a\n• b & c');
});

test('example recipe round-trips through validation unchanged', async () => {
  const raw = JSON.parse(await fs.readFile(exampleFile, 'utf8'));
  const v = validateRecipe(raw);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.recipe, raw);
});

test('example recipe file imports as json', async () => {
  const result = await importFile(await fs.readFile(exampleFile));
  assert.equal(result.method, 'json');
  assert.deepEqual(result.errors, []);
});

test('validator catches problems', () => {
  assert.deepEqual(validateRecipe([]).errors, ['The recipe must be a JSON object.']);
  assert.ok(validateRecipe({ title: 'x' }).errors.includes('The recipe has no ingredients and no steps.'));
  const v = validateRecipe({ title: 'x', servings: 2, ingredients: [{ amount: 'lots', name: 'salt' }, { amount: '½', name: 'lemon' }], steps: ['Add 2 cups of water.'] });
  assert.equal(v.errors.length, 1);
  assert.equal(v.recipe.ingredients[1].amount, '1/2');
  assert.ok(v.warnings.some((w) => w.includes('"2 cups"')));
});

test('slugs', () => {
  assert.equal(slugify('Crème Brûlée & Friends!'), 'creme-brulee-and-friends');
  assert.equal(slugify("Mum's Best Chilli"), 'mums-best-chilli');
  assert.equal(checkSlug('good-slug-2'), null);
  for (const bad of ['../etc', 'Bad', 'a--b', '-a', 'index', '', 'a/b', 'a.json']) assert.ok(checkSlug(bad), bad);
});

test('save refuses to overwrite unless asked', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nammet-'));
  try {
    await saveRecipe('toast', { title: 'Toast', steps: ['Toast it.'] }, { dir });
    await assert.rejects(saveRecipe('toast', { title: 'Toast 2' }, { dir }), (e) => e.status === 409);
    await saveRecipe('toast', { title: 'Toast 2' }, { dir, overwrite: true });
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'toast.json'), 'utf8')).title, 'Toast 2');
    assert.deepEqual((await fs.readdir(dir)).sort(), ['toast.json']); // no temp files left behind
    await assert.rejects(saveRecipe('../evil', {}, { dir }), (e) => e.status === 400);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('private addresses are blocked', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])assert.equal(isPublicAddress(ip), true, ip);

  for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://localhost/', 'file:///etc/passwd', 'http://example.com:8080/', 'http://2130706433/']) {
    await assert.rejects(fetchUrl(url), /private|reserved|Only|ports/i, url);
  }
});

test('passwords', async () => {
  const h = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});
