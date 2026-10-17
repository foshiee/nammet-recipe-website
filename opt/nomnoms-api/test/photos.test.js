// Run with: npm test   (no network or API key needed)
// Recipe photos, against recipe and photo folders in a temp folder.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nomnoms-photos-'));
process.env.RECIPES_DIR = path.join(tmp, 'recipes');
process.env.PHOTOS_DIR = path.join(tmp, 'photos');

// Imported after the environment is set, because config.js reads it once
const photos = await import('../photos.js');

before(async () => {
  await fs.mkdir(process.env.RECIPES_DIR);
  await fs.mkdir(process.env.PHOTOS_DIR);
});

after(() => fs.rm(tmp, { recursive: true, force: true }));

// A JPEG's structure, enough for the metadata walk (it isn't decoded)
const segment = (marker, body) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, Buffer.from(body)]);
};
const JFIF = segment(0xe0, 'JFIF\0\x01\x01');
const ICC = segment(0xe2, 'ICC_PROFILE\0\x01\x01colour');
const SCAN = Buffer.concat([segment(0xdb, 'quant-tables'), segment(0xda, 'scan-header'), Buffer.from('pixels \xff\xe1 not a segment'), Buffer.from([0xff, 0xd9])]);
const jpeg = (...extra) => Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF, ...extra.map((e) => Buffer.from(e)), SCAN]);
const EXIF = segment(0xe1, 'Exif\0\0GPS 51.5N 0.12W');
const XMP = segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>');
const MPF = segment(0xe2, 'MPF\0second picture');
const COMMENT = segment(0xfe, 'taken at home');

const recipeFile = (slug) => path.join(process.env.RECIPES_DIR, slug + '.json');
const readRecipe = async (slug) => JSON.parse(await fs.readFile(recipeFile(slug), 'utf8'));
const writeRecipe = (slug, r) => fs.writeFile(recipeFile(slug), JSON.stringify(r, null, 2));
const photoFiles = async () => (await fs.readdir(process.env.PHOTOS_DIR)).sort();

test('metadata is stripped, image data kept', () => {
  const out = photos.stripJpegMetadata(jpeg(EXIF, XMP, ICC, MPF, COMMENT));
  assert.deepEqual(out, jpeg(ICC));
  assert.ok(!out.includes('GPS'));
  assert.ok(!out.includes('taken at home'));
  // Bytes after the start of the scan are image data, copied as they are
  assert.ok(out.includes('not a segment'));
});

test('only JPEG is accepted', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.throws(() => photos.stripJpegMetadata(png), (e) => e.status === 415);
  assert.throws(() => photos.stripJpegMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40])), (e) => e.status === 415); // truncated
  assert.throws(() => photos.stripJpegMetadata(Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF])), (e) => e.status === 415); // no image data
});

test('setting, replacing and removing a photo', async () => {
  await writeRecipe('toast', { title: 'Toast', source: 'Mum', steps: ['Toast it.'], notes: ['Hot.'], author: 'me' });

  const first = await photos.setPhoto('toast', jpeg(EXIF));
  assert.match(first.image, /^photos\/toast-[0-9a-f]{10}\.jpg$/);
  let r = await readRecipe('toast');
  assert.equal(r.image, first.image);
  assert.deepEqual(Object.keys(r), ['title', 'source', 'image', 'steps', 'notes', 'author']);
  assert.deepEqual(await fs.readFile(path.join(tmp, first.image)), jpeg());
  assert.equal(await photos.currentImage('toast'), first.image);

  const second = await photos.setPhoto('toast', jpeg(COMMENT, ICC));
  assert.notEqual(second.image, first.image);
  assert.deepEqual(await photoFiles(), [path.basename(second.image)]); // the old one is gone, no temp files

  await photos.removePhoto('toast');
  r = await readRecipe('toast');
  assert.equal(r.image, undefined);
  assert.equal(r.author, 'me');
  assert.deepEqual(await photoFiles(), []);
});

test('photos placed by hand are never deleted', async () => {
  await fs.writeFile(path.join(process.env.PHOTOS_DIR, 'my-soup.jpg'), 'by hand');
  await writeRecipe('soup', { title: 'Soup', image: 'photos/my-soup.jpg', steps: ['Heat it.'] });
  const set = await photos.setPhoto('soup', jpeg());
  assert.deepEqual(await photoFiles(), [path.basename(set.image), 'my-soup.jpg'].sort());
  await writeRecipe('soup', { title: 'Soup', image: 'photos/my-soup.jpg', steps: ['Heat it.'] });
  await photos.removePhoto('soup');
  assert.ok((await photoFiles()).includes('my-soup.jpg'));

  // Another recipe's photo isn't this recipe's to delete, even if it's named like ours
  await photos.replacedPhoto('soup', set.image, '');
  assert.deepEqual(await photoFiles(), ['my-soup.jpg']);
  const other = await photos.setPhoto('toast', jpeg());
  await photos.replacedPhoto('soup', other.image, '');
  assert.ok((await photoFiles()).includes(path.basename(other.image)));
});

test('unknown recipes and bad names are refused', async () => {
  await assert.rejects(photos.setPhoto('no-such-recipe', jpeg()), (e) => e.status === 404);
  await assert.rejects(photos.setPhoto('../etc/passwd', jpeg()), (e) => e.status === 400);
  await assert.rejects(photos.removePhoto('index'), (e) => e.status === 400);
  await assert.rejects(photos.setPhoto('toast', Buffer.alloc(photos.MAX_PHOTO_BYTES + 1)), (e) => e.status === 413);
  assert.equal(await photos.currentImage('../etc/passwd'), '');
});
