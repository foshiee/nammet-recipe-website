// Recipe photos: stores an uploaded photo in the public photos folder and points the
// recipe's "image" field at it.
//
// The browser resizes and re-encodes every photo as JPEG before uploading, which also
// drops the camera's metadata. As a second line of defence only JPEG is accepted here,
// and the metadata segments (EXIF with GPS, XMP, comments) are removed again.
//
// File names carry a hash of the content (photos/<slug>-<hash>.jpg), so a replaced photo
// gets a new address and nginx can let browsers cache them. Only files named that way
// are ever deleted; photos placed on the server by hand are left alone. Deleting a recipe
// happens here too, in the same queue, since it removes the recipe's photo with it.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { readRecipeFile, saveRecipe, SaveError } from './save.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export class PhotoError extends Error {
  constructor(message, status = 400, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const isJpeg = (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const ICC = Buffer.from('ICC_PROFILE\0', 'latin1');

// Copies the segments before the image data, leaving out APP1 and APP3-APP15 (EXIF, XMP,
// maker notes) and comments. APP2 is kept only when it's a colour profile.
export function stripJpegMetadata(b) {
  const bad = () => new PhotoError("That photo couldn't be read. Try another one.", 415);
  if (!isJpeg(b)) throw new PhotoError('Photos must be JPEG images.', 415);
  const parts = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw bad();
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // padding
    const end = i + 2 + b.readUInt16BE(i + 2);
    if (end > b.length || end < i + 4) throw bad();
    if (marker === 0xda) { // start of scan: the rest is image data
      parts.push(b.subarray(i));
      return Buffer.concat(parts);
    }
    const app2Icc = marker === 0xe2 && b.subarray(i + 4, i + 4 + ICC.length).equals(ICC);
    const drop = (marker >= 0xe1 && marker <= 0xef && !app2Icc) || marker === 0xfe;
    if (!drop) parts.push(b.subarray(i, end));
    i = end;
  }
  throw bad();
}

const ownedBy = (slug, image) => new RegExp(`^photos/${slug}-[0-9a-f]{10}\\.jpg$`).test(String(image || ''));

async function removeOwned(slug, image) {
  if (ownedBy(slug, image)) await fs.rm(path.join(config.photosDir, path.basename(image)), { force: true });
}

async function readRecipe(slug) {
  try {
    return (await readRecipeFile(slug)).recipe;
  } catch (e) {
    if (!(e instanceof SaveError)) throw e;
    throw new PhotoError(e.status === 422 ? "That recipe's file can't be read, so its photo can't be changed." : e.message, e.status);
  }
}

// One change at a time, so two uploads for the same recipe can't leave a stray file
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

// Puts `image` before the fields the site ignores, as validate.js orders them
function withImage(recipe, image) {
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(recipe)) {
    if (k === 'image') continue;
    if (!placed && ['ingredients', 'steps', 'notes'].includes(k)) { out.image = image; placed = true; }
    out[k] = v;
  }
  if (!placed) out.image = image;
  return out;
}

export function setPhoto(slug, buffer) {
  return serial(async () => {
    if (buffer.length > MAX_PHOTO_BYTES) throw new PhotoError(`Photos must be under ${MAX_PHOTO_BYTES / 1048576} MB.`, 413);
    const data = stripJpegMetadata(buffer);
    const recipe = await readRecipe(slug);
    const name = `${slug}-${crypto.createHash('sha256').update(data).digest('hex').slice(0, 10)}.jpg`;
    const image = `photos/${name}`;
    const previous = recipe.image;

    const tmp = path.join(config.photosDir, `.${name}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    await fs.writeFile(tmp, data, { mode: 0o644, flag: 'wx' });
    await fs.rename(tmp, path.join(config.photosDir, name)).catch(async (e) => {
      await fs.rm(tmp, { force: true });
      throw e;
    });
    if (previous === image) return { image };
    try {
      await saveRecipe(slug, withImage(recipe, image), { overwrite: true });
    } catch (e) {
      await fs.rm(path.join(config.photosDir, name), { force: true });
      throw e;
    }
    await removeOwned(slug, previous);
    return { image };
  });
}

export function removePhoto(slug) {
  return serial(async () => {
    const recipe = await readRecipe(slug);
    if (!recipe.image) return { image: '' };
    const { image, ...rest } = recipe;
    await saveRecipe(slug, rest, { overwrite: true });
    await removeOwned(slug, image);
    return { image: '' };
  });
}

// Replaces a saved recipe, keeping its photo unless the new file names another one.
// With a version (from readRecipeFile), it refuses when the file has changed since, which
// includes a photo change. In the queue, so nothing can save in between check and write.
export function replaceRecipe(slug, recipe, version) {
  return serial(async () => {
    let current = null;
    try {
      current = await readRecipeFile(slug);
    } catch (e) {
      if (!(e instanceof SaveError) || e.status === 400) throw e;
    }
    if (version !== undefined && version !== null) {
      if (!current) throw new PhotoError('Someone removed this recipe after you opened it.', 409, { changed: true });
      if (current.version !== version) throw new PhotoError('Someone changed this recipe after you opened it.', 409, { changed: true });
    }
    const previous = current ? String(current.recipe.image || '') : '';
    const out = previous && !recipe.image ? withImage(recipe, previous) : recipe;
    const saved = await saveRecipe(slug, out, { overwrite: true });
    if (previous && previous !== out.image) await removeOwned(slug, previous);
    return saved;
  });
}

// Deletes a recipe and the photo this service made for it. With a version, it refuses
// when the file has changed since. A file that can't be parsed can still be deleted.
export function deleteRecipe(slug, version) {
  return serial(async () => {
    let current = null;
    try {
      current = await readRecipeFile(slug);
    } catch (e) {
      if (!(e instanceof SaveError) || e.status !== 422) throw e;
    }
    if (version !== undefined && version !== null && (!current || current.version !== version)) {
      throw new PhotoError('Someone changed this recipe after you opened it.', 409, { changed: true });
    }
    await fs.rm(path.join(config.recipesDir, slug + '.json'));
    if (current) await removeOwned(slug, current.recipe.image);
    return { slug };
  });
}
