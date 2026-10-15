// Writes a recipe into the served recipes folder.
//
// The file appears on the site through nginx's JSON folder listing. To make sure
// the listing never shows a half-written file, the recipe is written to a hidden
// temp file (not ending in .json, so the site ignores it) and then moved into place.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 80;

export function slugify(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
}

export function checkSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug.length > MAX_SLUG) {
    return 'Use lowercase letters, numbers and single hyphens only, such as "garlic-tomato-spaghetti".';
  }
  if (slug === 'index') return '"index" is reserved by the site. Choose another name.';
  return null;
}

export class SaveError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function saveRecipe(slug, recipe, { overwrite = false, dir = config.recipesDir } = {}) {
  const problem = checkSlug(slug);
  if (problem) throw new SaveError(problem, 400);

  dir = path.resolve(dir);
  const target = path.join(dir, slug + '.json');
  if (path.dirname(target) !== dir) throw new SaveError('Invalid file name.', 400); // belt and braces

  const tmp = path.join(dir,`.${slug}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(recipe, null, 2) + '\n', { encoding: 'utf8', mode: 0o644, flag: 'wx' });
  try {
    if (overwrite) {
      await fs.rename(tmp, target);
    } else {
      // link() fails if the target exists, so two saves can't silently replace each other
      try {
        await fs.link(tmp, target);
        await fs.unlink(tmp);
      } catch (e) {
        if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS', 'EINVAL'].includes(e.code)) throw e;
        // Filesystem without hard links (some sync/network drives): check, then rename
        if (await fs.access(target).then(() => true, () => false)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        await fs.rename(tmp, target);
      }
    }
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    if (e.code === 'EEXIST') throw new SaveError(`A recipe called "${slug}" already exists.`, 409);
    throw e;
  }
  return { slug, file: slug + '.json' };
}
