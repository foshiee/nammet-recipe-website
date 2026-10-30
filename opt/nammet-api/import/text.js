// Small text helpers shared by the importers.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  deg: '°', frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔', frac18: '⅛',
  times: '×', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', ntilde: 'ñ',
  uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•'
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// For short fields such as titles and step text: drop tags, decode, tidy spaces.
export function cleanText(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// For whole pages sent to Claude: keep block structure as line breaks, drop
// scripts, styles and markup.
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ISO 8601 duration ("PT1H45M") to seconds.
export function isoDurationSeconds(d) {
  const m = String(d || '').match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return 0;
  const [, days, h, min, sec] = m.map((x) => Number(x) || 0);
  return Math.round(days * 86400 + h * 3600 + min * 60 + sec);
}

// 6300 -> "1 hr 45 min" (the style used in the docs)
export function humanDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return [h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

// The single duration mentioned in a step ("bake for 25-30 minutes"), in seconds.
// Ranges use the lower bound so the cook checks early. Returns 0 when the step
// mentions no duration or more than one, since then it isn't clear which to time.
const DURATION_RE = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;

export function stepTimer(text) {
  const found = [...String(text).matchAll(DURATION_RE)];
  if (found.length !== 1) return 0;
  const n = Number(found[0][1]);
  const unit = found[0][2].toLowerCase();
  const sec = unit.startsWith('h') ? n * 3600 : unit.startsWith('m') ? n * 60 : n;
  return Math.round(sec);
}
