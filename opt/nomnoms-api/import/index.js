// Turns an uploaded file, a web address or pasted text into a draft recipe.
// Structured inputs are converted directly; everything else goes to Claude.
//
// Result: { recipe, method: 'json' | 'jsonld' | 'claude', errors, warnings, slug }

import { extractJsonLdRecipe, findRecipeObject, mapJsonLdRecipe } from './jsonld.js';
import { extractWithClaude, LlmError } from './llm.js';
import { fetchUrl, FetchError } from './fetch-url.js';
import { htmlToText } from './text.js';
import { validateRecipe } from './validate.js';
import { slugify } from '../save.js';

export class ImportError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

// Decide what a file is from its first bytes, not its name
export function sniff(buffer) {
  const b = buffer;
  const ascii = (start, s) => b.length >= start + s.length && b.toString('latin1', start, start + s.length) === s;
  if (ascii(0, '%PDF-')) return { kind: 'pdf' };
  if (b.length > 8 && b[0] === 0x89 && ascii(1, 'PNG')) return { kind: 'image', mediaType: 'image/png' };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mediaType: 'image/jpeg' };
  if (ascii(0, 'GIF8')) return { kind: 'image', mediaType: 'image/gif' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', mediaType: 'image/webp' };
  if (ascii(4, 'ftyp') && /^(heic|heix|mif1|msf1)$/.test(b.toString('latin1', 8, 12))) return { kind: 'heic' };
  if (ascii(0, 'PK\u0003\u0004')) return { kind: 'zip' };

  // Text: no NUL bytes in the first few KB
  if (b.subarray(0, 8192).includes(0)) return { kind: 'binary' };
  const text = b.toString('utf8').replace(/^﻿/, '');
  const head = text.slice(0, 2048).trimStart();
  if (/^[{[]/.test(head)) return { kind: 'json', text };
  if (/^<(!doctype html|html|head|body|meta|div|script)/i.test(head) || /<html[\s>]/i.test(text.slice(0, 4096))) return { kind: 'html', text };
  return { kind: 'text', text };
}

function looksLikeOurFormat(o) {
  return o && typeof o === 'object' && !Array.isArray(o) && !o['@type'] && !o['@context'] &&
    (Array.isArray(o.ingredients) || Array.isArray(o.steps));
}

function finish(recipe, method, warnings = []) {
  const v = validateRecipe(recipe);
  return {
    recipe: v.recipe,
    method,
    errors: v.errors,
    warnings: [...warnings, ...v.warnings],
    slug: slugify(v.recipe && v.recipe.title)
  };
}

async function viaClaude(input, warnings = []) {
  try {
    return finish(await extractWithClaude(input), 'claude', warnings);
  } catch (e) {
    if (e instanceof LlmError) throw new ImportError(e.message, e.status);
    throw e;
  }
}

async function fromSniffed(s, buffer, { url } = {}) {
  switch (s.kind) {
    case 'pdf':
      return viaClaude({ kind: 'pdf', buffer });
    case 'image':
      return viaClaude({ kind: 'image', buffer, mediaType: s.mediaType });
    case 'heic':
      throw new ImportError('HEIC photos (the iPhone default) aren\'t supported. Export the photo as JPEG, or take a screenshot of it, and try again.', 415);
    case 'zip':
      throw new ImportError('Word, Excel and other zipped documents aren\'t supported. Save it as a PDF and import that instead.', 415);
    case 'binary':
      throw new ImportError("That file type isn't supported. Use a recipe .json file, a PDF, a photo, a web page or plain text.", 415);
    case 'json': {
      let data;
      try {
        data = JSON.parse(s.text);
      } catch (e) {
        throw new ImportError(`That JSON file has a syntax error: ${e.message}`);
      }
      if (looksLikeOurFormat(data)) return finish(data, 'json');
      const ld = findRecipeObject(data);
      if (ld) return finish(mapJsonLdRecipe(ld, url), 'jsonld');
      throw new ImportError("That JSON file isn't a recipe in this site's format or schema.org format.");
    }
    case 'html': {
      const ld = extractJsonLdRecipe(s.text);
      if (ld) return finish(mapJsonLdRecipe(ld, url), 'jsonld');
      const result = await viaClaude({ kind: 'html', text: htmlToText(s.text), url });
      if (url && !result.recipe.source) result.recipe.source = url;
      return result;
    }
    default:
      return viaClaude({ kind: 'text', text: s.text });
  }
}

export function importFile(buffer) {
  if (!buffer || !buffer.length) throw new ImportError('The file is empty.');
  return fromSniffed(sniff(buffer), buffer);
}

export function importText(text) {
  text = String(text || '').trim();
  if (!text) throw new ImportError('Paste some recipe text first.');
  return fromSniffed(sniff(Buffer.from(text, 'utf8')), Buffer.from(text, 'utf8'));
}

export async function importUrl(url, maxBytes) {
  let page;
  try {
    page = await fetchUrl(url, { maxBytes });
  } catch (e) {
    if (e instanceof FetchError) throw new ImportError(e.message, 422);
    throw e;
  }
  if (!page.buffer.length) throw new ImportError('The page was empty.');
  return fromSniffed(sniff(page.buffer), page.buffer, { url: page.finalUrl });
}
