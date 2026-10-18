(() => {
  'use strict';

  const app = document.getElementById('app');
  const foot = document.getElementById('account-foot');

  /* ---------- helpers ---------- */

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const getPref = (key, fallback) => {
    try {
      const v = localStorage.getItem('recipes:' + key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  };

  const setPref = (key, value) => {
    try { localStorage.setItem('recipes:' + key, value); } catch (e) { /* storage unavailable */ }
  };

  const trim = (n, digits) => String(parseFloat(n.toFixed(digits)));

  /* ---------- units ---------- */

  const ALIASES = {
    teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
    tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp',
    cups: 'cup',
    'fl oz': 'fl_oz', floz: 'fl_oz', 'fluid ounce': 'fl_oz', 'fluid ounces': 'fl_oz',
    ounce: 'oz', ounces: 'oz', ozs: 'oz',
    pound: 'lb', pounds: 'lb', lbs: 'lb',
    gram: 'g', grams: 'g', gms: 'g',
    kilogram: 'kg', kilograms: 'kg', kgs: 'kg',
    milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', mls: 'ml',
    liter: 'l', liters: 'l', litre: 'l', litres: 'l'
  };

  // Everything in millilitres / grams
  const VOL = { tsp: 4.92892, tbsp: 14.7868, cup: 236.588, fl_oz: 29.5735, ml: 1, l: 1000 };
  const WT = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000 };

  const normUnit = (u) => {
    if (u === null || u === undefined) return '';
    const s = String(u).trim().toLowerCase().replace(/\./g, '');
    return ALIASES[s] || s;
  };

  // "Nice" rounding for values that were converted (not typed by the author)
  const niceRound = (v) => {
    if (v < 20) return Math.round(v);
    if (v < 200) return Math.round(v / 5) * 5;
    return Math.round(v / 10) * 10;
  };

  const metricVolume = (ml, converted) => {
    ml = converted ? niceRound(ml) : (ml < 10 ? Math.round(ml * 10) / 10 : Math.round(ml));
    return ml >= 1000 ? { value: ml / 1000, unit: 'l', kind: 'metric' } : { value: ml, unit: 'ml', kind: 'metric' };
  };

  const metricWeight = (g, converted) => {
    g = converted ? niceRound(g) : (g < 10 ? Math.round(g * 10) / 10 : Math.round(g));
    return g >= 1000 ? { value: g / 1000, unit: 'kg', kind: 'metric' } : { value: g, unit: 'g', kind: 'metric' };
  };

  const usVolume = (ml) => {
    if (ml >= 59) return { value: ml / VOL.cup, unit: 'cup', kind: 'us' };
    if (ml >= 13) return { value: ml / VOL.tbsp, unit: 'tbsp', kind: 'us' };
    return { value: ml / VOL.tsp, unit: 'tsp', kind: 'us' };
  };

  const usWeight = (g) => {
    const oz = g / WT.oz;
    return oz >= 16 ? { value: oz / 16, unit: 'lb', kind: 'us' } : { value: oz, unit: 'oz', kind: 'us' };
  };

  function convert(value, unit, system, rawUnit) {
    if (VOL[unit] !== undefined) {
      const ml = value * VOL[unit];
      const isMetric = unit === 'ml' || unit === 'l';
      if (system === 'us') return isMetric ? usVolume(ml) : { value, unit, kind: 'us' };
      if (isMetric) return metricVolume(ml, false);
      if (unit === 'tsp' || unit === 'tbsp') return { value, unit, kind: 'spoon' }; // metric spoons are standard
      return metricVolume(ml, true);
    }
    if (WT[unit] !== undefined) {
      const g = value * WT[unit];
      const isMetric = unit === 'g' || unit === 'kg';
      if (system === 'us') return isMetric ? usWeight(g) : { value, unit, kind: 'us' };
      return isMetric ? metricWeight(g, false) : metricWeight(g, true);
    }
    return { value, unit: rawUnit, kind: 'other' };
  }

  /* ---------- number formatting ---------- */

  const FRACTIONS = [
    [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
    [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']
  ];

  function fmtFraction(x) {
    if (x <= 0) return '0';
    let whole = Math.floor(x + 1e-9);
    const frac = x - whole;
    let best = FRACTIONS[0];
    let bestDiff = Infinity;
    for (const f of FRACTIONS) {
      const d = Math.abs(frac - f[0]);
      if (d < bestDiff) { best = f; bestDiff = d; }
    }
    if (best[0] === 1) { whole += 1; best = FRACTIONS[0]; }
    if (whole === 0 && best[1] === '') return '⅛'; // smallest amount we show
    return (whole ? String(whole) : '') + (whole && best[1] ? '\u2009' : '') + best[1];
  }

  const fmtMetric = (value, unit) =>
    unit === 'l' || unit === 'kg' ? trim(value, 2) : (value < 10 ? trim(value, 1) : String(Math.round(value)));

  function parseAmount(a) {
    if (a === null || a === undefined || a === '') return null;
    if (typeof a === 'number') return isFinite(a) ? a : null;
    const s = String(a).trim();
    const m = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
    if (m) return (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]);
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  function amountText(item, factor, system) {
    const base = parseAmount(item.amount);
    if (base === null) return item.unit ? String(item.unit) : '';
    const rawUnit = item.unit ? String(item.unit).trim() : '';
    const c = convert(base * factor, normUnit(item.unit), system, rawUnit);
    const num = c.kind === 'metric' ? fmtMetric(c.value, c.unit) : fmtFraction(c.value);
    let label = c.unit;
    if (c.unit === 'fl_oz') label = 'fl oz';
    if (c.unit === 'cup' && !/^(1|[⅛¼⅓⅜½⅝⅔¾⅞])$/.test(num)) label = 'cups';
    return label ? num + ' ' + label : num;
  }

  function fmtDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (h) parts.push(h + ' hr');
    if (m) parts.push(m + ' min');
    if (s && !h) parts.push(s + ' sec');
    return parts.join(' ');
  }

  function fmtClock(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  /* ---------- state & data ---------- */

  const state = {
    recipes: [],
    loadFailed: false,
    problems: [],
    units: getPref('units', 'us') === 'metric' ? 'metric' : 'us',
    query: '',
    tag: null,
    current: null,
    servings: 1,
    checked: new Set(),
    timers: {},
    wakeLock: null,
    wakeWanted: false,
    user: null,
    userKnown: false,
    imp: { busy: false, error: '', draft: null },
    edit: null, // the draft on #/edit/<slug>, kept apart so an import in progress survives
    editor: getPref('editor', 'form') === 'json' ? 'json' : 'form',
    site: { name: 'Recipes', thumbnails: false },
    photo: { busy: false, msg: null },
    admin: null
  };

  // A photo in the site's photos folder; anything else (such as another site's address) is
  // ignored. The same pattern is in opt/nomnoms-api/import/validate.js.
  const IMAGE_RE = /^photos\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:jpe?g|png|webp)$/;

  function normalizeGroups(raw) {
    if (!Array.isArray(raw)) return [];
    const toItem = (x) =>
      typeof x === 'string'
        ? { name: x }
        : { amount: x.amount, unit: x.unit, name: String(x.name || ''), note: x.note || '' };
    const groups = [];
    let loose = null;
    for (const e of raw) {
      if (e && Array.isArray(e.items)) {
        groups.push({ name: e.group || e.name || '', items: e.items.map(toItem) });
        loose = null;
      } else {
        if (!loose) { loose = { name: '', items: [] }; groups.push(loose); }
        loose.items.push(toItem(e));
      }
    }
    return groups;
  }

  function normalizeRecipe(raw, file) {
    const slug = file.replace(/\.json$/i, '');
    const servings = Number(raw.servings) > 0 ? Number(raw.servings) : 4;
    const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((s) =>
      typeof s === 'string'
        ? { title: '', text: s, timer: 0 }
        : { title: s.title || '', text: s.text || '', timer: Number(s.timer) > 0 ? Math.round(Number(s.timer)) : 0 }
    );
    const notes = Array.isArray(raw.notes) ? raw.notes : (raw.notes ? [raw.notes] : []);
    const tags = (Array.isArray(raw.tags) ? raw.tags : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    const groups = normalizeGroups(raw.ingredients);
    const r = {
      slug,
      title: String(raw.title || slug),
      description: raw.description || '',
      servings,
      time: raw.time || '',
      tags,
      groups,
      steps,
      notes: notes.map(String),
      source: raw.source || '',
      image: typeof raw.image === 'string' && IMAGE_RE.test(raw.image) ? raw.image : ''
    };
    r.search = [
      r.title, r.description, tags.join(' '),
      groups.map((g) => g.items.map((i) => i.name).join(' ')).join(' ')
    ].join(' ').toLowerCase();
    return r;
  }

  async function loadRecipes() {
    state.problems = [];
    state.loadFailed = false;
    let files = null;

    // Preferred: nginx lists the folder as JSON, so new files appear automatically.
    try {
      const res = await fetch('recipes/', { headers: { Accept: 'application/json' }, cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) files = data.filter((e) => e && e.type === 'file').map((e) => e.name);
      }
    } catch (e) { /* fall through */ }

    // Fallback: a hand-written recipes/index.json containing a list of file names.
    if (!files) {
      try {
        const res = await fetch('recipes/index.json', { cache: 'no-cache' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) files = data.map((f) => (/\.json$/i.test(String(f)) ? String(f) : f + '.json'));
        }
      } catch (e) { /* no fallback available */ }
    }

    if (!files) {
      state.loadFailed = true;
      return;
    }

    files = files.filter((f) => /\.json$/i.test(f) && f.toLowerCase() !== 'index.json');

    const loaded = await Promise.all(files.map(async (f) => {
      try {
        const res = await fetch('recipes/' + encodeURIComponent(f), { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return normalizeRecipe(await res.json(), f);
      } catch (e) {
        state.problems.push(`${f} (${e.message})`);
        return null;
      }
    }));

    state.recipes = loaded.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  }

  // Site name and icon chosen on the admin page. The service writes theme/site.json;
  // without it (no service, or nothing saved yet) the defaults stay.
  async function loadSite() {
    try {
      const res = await fetch('theme/site.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const site = await res.json();
      if (typeof site.name === 'string' && site.name.trim()) state.site.name = site.name.trim();
      if (typeof site.favicon === 'string' && /^theme\/favicon\.(svg|png|ico|webp)(\?v=[0-9a-f]+)?$/.test(site.favicon)) {
        document.getElementById('favicon').href = site.favicon;
      }
      state.site.thumbnails = site.thumbnails === true;
    } catch (e) { /* keep the defaults */ }
  }

  const pageTitle = (sub) => { document.title = sub ? `${sub} | ${state.site.name}` : state.site.name; };

  /* ---------- home view ---------- */

  function showHome() {
    pageTitle();

    if (state.loadFailed) {
      app.innerHTML = `
        <h1>${esc(state.site.name)}</h1>
        <div class="notice">
          <p><strong>Couldn't load the recipe list.</strong></p>
          <p>The site looks for a <code>recipes/</code> folder next to this page. Check that it exists and that nginx has <code>autoindex on; autoindex_format json;</code> set for <code>/recipes/</code>.</p>
        </div>`;
      return;
    }

    const n = state.recipes.length;
    const problems = state.problems.length
      ? `<div class="notice"><p><strong>Some recipe files couldn't be read:</strong></p>${state.problems.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`
      : '';

    app.innerHTML = `
      <section class="home">
        <div class="home-head">
          <h1>${esc(state.site.name)}</h1>
          <div id="account-head"></div>
        </div>
        ${n ?`<p class="count">${n} ${n === 1 ? 'recipe' : 'recipes'}</p>
        <input id="search" type="search" placeholder="Search recipes or ingredients" aria-label="Search recipes" autocomplete="off" value="${esc(state.query)}">` : ''}
        <div id="tags" class="tags"></div>
        <ul id="list" class="list"></ul>
        <p id="empty" class="empty" hidden></p>
        ${problems}
      </section>`;

    drawTags();
    drawList();
    drawAccount();
  }

  // Someone with a temporary password can do nothing else until they've chosen their own
  const mustChangePassword = () => !!state.user && !!state.user.mustChangePassword;
  const canImport = () => !!state.user && !mustChangePassword() && (state.user.role === 'admin' || state.user.role === 'importer');
  const isAdmin = () => !!state.user && !mustChangePassword() && state.user.role === 'admin';
  const accountLinksHtml = () =>
    `Signed in as ${esc(state.user.username)} · ${isAdmin() ? '<a href="#/admin">Admin</a> · ' : ''}<a href="#/password">Change password</a> · <button class="link-button" data-action="logout">Sign out</button>`;

  // Import is offered on the home page to importers and admins, as are the edit and photo
  // buttons on a recipe page. The footer (outside #app,
  // so it's on every page) links to the admin page for admins, and visitors just see a
  // small sign-in link there. The server checks roles too.
  function drawAccount() {
    const head = document.getElementById('account-head');
    if (head) head.innerHTML = canImport() ? '<a class="button" href="#/import">Import recipe</a>' : '';
    drawPhotoTools();
    foot.innerHTML = !state.userKnown ? ''
      : state.user ? accountLinksHtml()
      : '<a href="#/import">Sign in</a>';
  }

  function drawTags() {
    const box = document.getElementById('tags');
    if (!box) return;
    const tags = [...new Set(state.recipes.flatMap((r) => r.tags))].sort();
    box.innerHTML = tags
      .map((t) => `<button class="tag" data-action="tag" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">${esc(t)}</button>`)
      .join('');
  }

  function drawList() {
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    if (!list) return;

    const q = state.query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const shown = state.recipes.filter(
      (r) => (!state.tag || r.tags.includes(state.tag)) && words.every((w) => r.search.includes(w))
    );

    // A photo beside each row that has one, when switched on in the admin page. Rows
    // without a photo look the same as with the setting off.
    const thumb = (r) => state.site.thumbnails && r.image;

    list.innerHTML = shown.map((r) => `
      <li>
        <a class="row${thumb(r) ? ' has-thumb' : ''}" href="#/r/${encodeURIComponent(r.slug)}">
          ${thumb(r) ? `<img class="photo thumb" src="${esc(r.image)}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="row-title">${esc(r.title)}</span>
          ${r.description ? `<span class="row-desc">${esc(r.description)}</span>` : ''}
          <span class="row-meta"><span>Serves ${esc(r.servings)}</span>${r.time ? `<span>${esc(r.time)}</span>` : ''}</span>
        </a>
      </li>`).join('');

    if (!state.recipes.length) {
      empty.hidden = false;
      empty.textContent = 'No recipes yet. Sign in and use Import recipe, or add a .json file to the recipes folder on the server and reload this page.';
    } else if (!shown.length) {
      empty.hidden = false;
      empty.innerHTML = 'Nothing matches your search. <button class="link-button" data-action="clear">Clear search</button>';
    } else {
      empty.hidden = true;
    }
  }

  /* ---------- recipe view ---------- */

  function showRecipe(slug) {
    const r = state.recipes.find((x) => x.slug === slug);
    if (!r) {
      pageTitle('Recipe not found');
      app.innerHTML = `
        <a class="back" href="#/">All recipes</a>
        <div class="notice"><p><strong>That recipe doesn't exist.</strong></p><p>It may have been renamed or removed.</p></div>`;
      return;
    }

    state.current = r;
    state.servings = r.servings;
    state.checked = new Set();
    state.timers = {};
    pageTitle(r.title);

    const wakeSupported = 'wakeLock' in navigator;
    const source = r.source
      ? (/^https?:\/\//i.test(r.source)
          ? `<p class="source">Source: <a href="${esc(r.source)}" rel="noopener noreferrer">${esc(r.source)}</a></p>`
          : `<p class="source">Source: ${esc(r.source)}</p>`)
      : '';

    app.innerHTML = `
      <article class="recipe">
        <a class="back" href="#/">All recipes</a>
        <header class="recipe-head">
          <div id="photo"></div>
          <h1>${esc(r.title)}</h1>
          ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
          <p class="facts"><span>Written for ${esc(r.servings)} servings</span>${r.time ? `<span>${esc(r.time)} total</span>` : ''}</p>
          <div id="photo-tools"></div>
        </header>

        <div class="controls" role="group" aria-label="Recipe controls">
          <div class="stepper" role="group" aria-label="Servings">
            <button data-action="serv-dec" aria-label="Fewer servings">&minus;</button>
            <output id="serv" aria-live="polite">${esc(state.servings)}</output>
            <button data-action="serv-inc" aria-label="More servings">+</button>
            <span class="ctl-label">servings</span>
          </div>
          <div class="seg" role="group" aria-label="Units">
            <button data-action="units" data-units="us" aria-pressed="${state.units === 'us'}">US</button>
            <button data-action="units" data-units="metric" aria-pressed="${state.units === 'metric'}">Metric</button>
          </div>
        </div>

        <label class="wake${wakeSupported ? ' available' : ''}">
          <input type="checkbox" data-action="wake"> Keep screen on while cooking
        </label>

        <div class="cols">
          <section class="ingredients" aria-labelledby="ing-h">
            <h2 id="ing-h">Ingredients</h2>
            <div id="ingredients"></div>
          </section>
          <section class="steps" aria-labelledby="steps-h">
            <h2 id="steps-h">Method</h2>
            <ol>
              ${r.steps.map((s, i) => `
                <li class="step" data-step="${i}">
                  <button class="num" data-action="step" aria-pressed="false" aria-label="Mark step ${i + 1} done">${i + 1}</button>
                  <div class="step-body">
                    ${s.title ? `<h3>${esc(s.title)}</h3>` : ''}
                    <p>${esc(s.text)}</p>
                    <div class="timer-slot" data-timer-slot="${i}" aria-live="polite">${timerHtml(i, s)}</div>
                  </div>
                </li>`).join('')}
            </ol>
          </section>
        </div>

        ${r.notes.length ? `<section class="notes"><h2>Notes</h2><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
        ${source}
      </article>`;

    if (state.photo.msg && state.photo.msg.slug !== r.slug) state.photo.msg = null;
    drawPhoto();
    drawPhotoTools();
    drawIngredients();
    drawControls();
  }

  function drawIngredients() {
    const box = document.getElementById('ingredients');
    const r = state.current;
    if (!box || !r) return;
    const factor = state.servings / r.servings;

    box.innerHTML = r.groups.map((g, gi) => `
      <div class="group">
        ${g.name ? `<h3>${esc(g.name)}</h3>` : ''}
        <ul>
          ${g.items.map((it, ii) => {
            const key = gi + '-' + ii;
            const note = it.note ? `<span class="note">, ${esc(it.note)}</span>` : '';
            return `<li><label class="ing"><input type="checkbox" data-action="ing" data-key="${key}"${state.checked.has(key) ? ' checked' : ''}><span class="amt">${esc(amountText(it, factor, state.units))}</span><span class="ing-name">${esc(it.name)}${note}</span></label></li>`;
          }).join('')}
        </ul>
      </div>`).join('');
  }

  function drawControls() {
    const out = document.getElementById('serv');
    if (out) out.textContent = state.servings;
    const dec = app.querySelector('[data-action="serv-dec"]');
    if (dec) dec.disabled = state.servings <= 1;
    app.querySelectorAll('[data-action="units"]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.units === state.units))
    );
  }

  function changeServings(delta) {
    state.servings = Math.min(99, Math.max(1, state.servings + delta));
    drawControls();
    drawIngredients();
  }

  function setUnits(u) {
    if (u !== 'us' && u !== 'metric') return;
    state.units = u;
    setPref('units', u);
    drawControls();
    drawIngredients();
  }

  function toggleStep(btn) {
    const li = btn.closest('.step');
    const done = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(done));
    btn.textContent = done ? '✓' : String(Number(li.dataset.step) + 1);
    li.classList.toggle('done', done);
  }

  /* ---------- timers ---------- */

  let tickId = null;
  let alarmId = null;
  let audioCtx = null;

  function timerHtml(i, step) {
    if (!step.timer) return '';
    const t = state.timers[i];
    if (!t) {
      return `<button class="timer" data-action="timer-start" data-i="${i}">Start ${fmtDuration(step.timer)} timer</button>`;
    }
    if (t.done) {
      return `<button class="timer done" data-action="timer-stop" data-i="${i}">Time's up. Tap to dismiss</button>`;
    }
    const left = Math.max(0, Math.ceil((t.end - Date.now()) / 1000));
    return `<button class="timer running" data-action="timer-stop" data-i="${i}" aria-label="Stop timer"><span class="clock" data-timer-time="${i}">${fmtClock(left)}</span><span>Stop</span></button>`;
  }

  function drawTimer(i) {
    const slot = app.querySelector(`[data-timer-slot="${i}"]`);
    if (slot && state.current) slot.innerHTML = timerHtml(i, state.current.steps[i]);
  }

  function ensureAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* audio unavailable */ }
  }

  function beep() {
    try {
      if (audioCtx) {
        const t0 = audioCtx.currentTime;
        [0, 0.25, 0.5].forEach((offset) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.0001, t0 + offset);
          gain.gain.exponentialRampToValueAtTime(0.4, t0 + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(t0 + offset);
          osc.stop(t0 + offset + 0.2);
        });
      }
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } catch (e) { /* ignore */ }
  }

  function startAlarm() {
    beep();
    if (!alarmId) alarmId = setInterval(beep, 4000);
  }

  function maybeStopAlarm() {
    const anyDone = Object.values(state.timers).some((t) => t.done);
    if (!anyDone && alarmId) {
      clearInterval(alarmId);
      alarmId = null;
    }
  }

  function tick() {
    const now = Date.now();
    let running = false;
    for (const [i, t] of Object.entries(state.timers)) {
      if (t.done) continue;
      const left = Math.ceil((t.end - now) / 1000);
      if (left <= 0) {
        t.done = true;
        drawTimer(i);
        startAlarm();
      } else {
        running = true;
        const el = app.querySelector(`[data-timer-time="${i}"]`);
        if (el) el.textContent = fmtClock(left);
      }
    }
    if (!running && tickId) {
      clearInterval(tickId);
      tickId = null;
    }
  }

  function startTimer(i) {
    const step = state.current && state.current.steps[i];
    if (!step || !step.timer) return;
    ensureAudio();
    state.timers[i] = { end: Date.now() + step.timer * 1000, done: false };
    drawTimer(i);
    if (!tickId) tickId = setInterval(tick, 250);
  }

  function stopTimer(i) {
    delete state.timers[i];
    drawTimer(i);
    maybeStopAlarm();
  }

  /* ---------- keep screen on ---------- */

  async function setWake(on) {
    state.wakeWanted = on;
    try {
      if (state.wakeLock) {
        await state.wakeLock.release();
        state.wakeLock = null;
      }
      if (on) state.wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      state.wakeWanted = false;
      const box = app.querySelector('[data-action="wake"]');
      if (box) box.checked = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.wakeWanted && state.current) setWake(true);
  });

  /* ---------- recipe photos ---------- */

  // Every photo is redrawn here before it's uploaded: scaled down, and saved as a fresh
  // JPEG, which leaves the camera's metadata (including where it was taken) behind.
  const PHOTO_EDGE = 1600;

  async function decodeImage(blob) {
    try {
      return await createImageBitmap(blob);
    } catch (e) {
      // Some browsers only decode certain formats (such as HEIC in Safari) through <img>
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  async function readPhoto(blob) {
    let src;
    try {
      src = await decodeImage(blob);
    } catch (e) {
      throw new Error("That photo couldn't be read. Try a JPEG, PNG or WebP image.");
    }
    return { src, w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  }

  // Draws part of a decoded photo (sx, sy, sw, sh in its own pixels) as the JPEG to upload
  async function renderPhoto(src, sx, sy, sw, sh) {
    const scale = Math.min(1, PHOTO_EDGE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!out) throw new Error("That photo couldn't be prepared. Try a smaller one.");
    return out;
  }

  // The whole photo, uncropped (used for the photo a web page publishes)
  async function preparePhoto(blob) {
    const p = await readPhoto(blob);
    try {
      return await renderPhoto(p.src, 0, 0, p.w, p.h);
    } finally {
      if (p.src.close) p.src.close();
    }
  }

  /* photo editor: crop to the recipe page's 3:2 frame, with zoom and repositioning */

  // editor = { src, w, h, preview, cx, cy, zoom, pointers, resolve, dialog, canvas }
  // cx/cy is the photo pixel at the middle of the frame; zoom 1 just fills the frame.
  let editor = null;
  const ZOOM_MAX = 4;
  const CROP_RATIO = 3 / 2; // matches .photo.hero and .crop-frame canvas in style.css

  // Resolves with the cropped JPEG, or null if cancelled
  async function editPhoto(blob) {
    closeEditor(null);
    const p = await readPhoto(blob);
    // A smaller copy keeps dragging smooth; the saved photo is cut from the original
    const scale = Math.min(1, 2000 / Math.max(p.w, p.h));
    const preview = document.createElement('canvas');
    preview.width = Math.max(1, Math.round(p.w * scale));
    preview.height = Math.max(1, Math.round(p.h * scale));
    preview.getContext('2d').drawImage(p.src, 0, 0, preview.width, preview.height);

    const dialog = document.createElement('dialog');
    dialog.className = 'cropper';
    dialog.setAttribute('aria-labelledby', 'crop-h');
    dialog.innerHTML = `
      <h2 id="crop-h">Adjust photo</h2>
      <p class="hint">Drag to move the photo, and zoom in to crop it. The frame shows how it will look at the top of the recipe.</p>
      <div class="crop-frame" data-action="crop-frame" tabindex="0" role="application"
        aria-label="Photo position. Arrow keys move it, plus and minus zoom.">
        <canvas></canvas>
      </div>
      <div class="crop-zoom">
        <label for="crop-zoom">Zoom</label>
        <input id="crop-zoom" type="range" min="1" max="${ZOOM_MAX}" step="0.01" value="1" data-action="crop-zoom">
      </div>
      <div class="actions">
        <button class="button" data-action="crop-done">Use photo</button>
        <button class="button secondary" data-action="crop-reset">Reset</button>
        <button class="button secondary" data-action="crop-cancel">Cancel</button>
      </div>`;
    app.appendChild(dialog);

    return new Promise((resolve) => {
      editor = { ...p, preview, cx: p.w / 2, cy: p.h / 2, zoom: 1, pointers: new Map(), resolve, dialog, canvas: dialog.querySelector('canvas') };
      dialog.showModal();
      dialog.querySelector('.crop-frame').focus();
      drawCrop();
    });
  }

  function closeEditor(result) {
    const e = editor;
    if (!e) return;
    editor = null;
    if (e.dialog.open) e.dialog.close();
    e.dialog.remove();
    if (e.src.close) e.src.close();
    e.resolve(result);
  }

  // Frame size in CSS pixels, and photo pixels per CSS pixel at the current zoom. The
  // height comes from the ratio rather than the layout, so the crop is exactly 3:2.
  function cropView() {
    const e = editor;
    const fw = e.canvas.clientWidth || 1;
    const fh = fw / CROP_RATIO;
    const k = 1 / (Math.max(fw / e.w, fh / e.h) * e.zoom);
    return { fw, fh, k, vw: fw * k, vh: fh * k };
  }

  // Keeps the frame filled: the photo can't be dragged or zoomed out past its edges
  function clampCrop() {
    const e = editor;
    e.zoom = Math.min(ZOOM_MAX, Math.max(1, e.zoom));
    const { vw, vh } = cropView();
    e.cx = Math.min(e.w - vw / 2, Math.max(vw / 2, e.cx));
    e.cy = Math.min(e.h - vh / 2, Math.max(vh / 2, e.cy));
  }

  function drawCrop() {
    const e = editor;
    if (!e) return;
    clampCrop();
    const { fw, fh, vw, vh } = cropView();
    const dpr = window.devicePixelRatio || 1;
    const c = e.canvas;
    if (c.width !== Math.round(fw * dpr) || c.height !== Math.round(fh * dpr)) {
      c.width = Math.round(fw * dpr);
      c.height = Math.round(fh * dpr);
    }
    const ctx = c.getContext('2d');
    const p = e.preview.width / e.w;
    ctx.drawImage(e.preview, (e.cx - vw / 2) * p, (e.cy - vh / 2) * p, vw * p, vh * p, 0, 0, c.width, c.height);
    const zoom = e.dialog.querySelector('#crop-zoom');
    if (zoom && Number(zoom.value) !== e.zoom) zoom.value = e.zoom;
  }

  // Zooms by `factor`, keeping the point under (ax, ay) in the frame where it is
  function zoomCrop(factor, ax, ay) {
    const e = editor;
    const before = cropView();
    if (ax === undefined) { ax = before.fw / 2; ay = before.fh / 2; }
    const ix = e.cx + (ax - before.fw / 2) * before.k;
    const iy = e.cy + (ay - before.fh / 2) * before.k;
    e.zoom = Math.min(ZOOM_MAX, Math.max(1, e.zoom * factor));
    const after = cropView();
    e.cx = ix - (ax - after.fw / 2) * after.k;
    e.cy = iy - (ay - after.fh / 2) * after.k;
    drawCrop();
  }

  function moveCrop(dx, dy) {
    const { k } = cropView();
    editor.cx -= dx * k;
    editor.cy -= dy * k;
    drawCrop();
  }

  async function finishCrop(btn) {
    const e = editor;
    e.dialog.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    btn.textContent = 'Preparing…';
    const { vw, vh } = cropView();
    try {
      closeEditor(await renderPhoto(e.src, e.cx - vw / 2, e.cy - vh / 2, vw, vh));
    } catch (err) {
      closeEditor(null);
      alert(err.message);
    }
  }

  // Pointer position relative to the frame
  const framePoint = (ev) => {
    const r = editor.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  function cropPointerDown(ev) {
    ev.preventDefault();
    ev.target.setPointerCapture(ev.pointerId);
    editor.pointers.set(ev.pointerId, framePoint(ev));
  }

  // One pointer drags; two pinch-zoom around their midpoint and drag with it
  function cropPointerMove(ev) {
    const e = editor;
    const last = e.pointers.get(ev.pointerId);
    if (!last) return;
    const now = framePoint(ev);
    if (e.pointers.size === 1) {
      e.pointers.set(ev.pointerId, now);
      moveCrop(now.x - last.x, now.y - last.y);
      return;
    }
    const [a, b] = [...e.pointers.values()];
    const mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist0 = Math.hypot(a.x - b.x, a.y - b.y);
    e.pointers.set(ev.pointerId, now);
    const [c, d] = [...e.pointers.values()];
    const mid1 = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    const dist1 = Math.hypot(c.x - d.x, c.y - d.y);
    if (dist0 > 0) zoomCrop(dist1 / dist0, mid1.x, mid1.y);
    moveCrop(mid1.x - mid0.x, mid1.y - mid0.y);
  }

  function cropKey(ev) {
    const step = 20;
    const keys = {
      // The photo moves the way the arrow points, as if dragged
      ArrowLeft: () => moveCrop(-step, 0), ArrowRight: () => moveCrop(step, 0),
      ArrowUp: () => moveCrop(0, -step), ArrowDown: () => moveCrop(0, step),
      '+': () => zoomCrop(1.1), '=': () => zoomCrop(1.1), '-': () => zoomCrop(1 / 1.1)
    };
    if (!keys[ev.key]) return;
    ev.preventDefault();
    keys[ev.key]();
  }

  function base64Blob(data, type) {
    const bytes = atob(data);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return new Blob([buf], { type });
  }

  function uploadPhoto(slug, blob) {
    const form = new FormData();
    form.append('slug', slug);
    form.append('file', blob, slug + '.jpg');
    return api('recipes/photo', { method: 'POST', form });
  }

  // The recipe objects are shared by the list and the recipe page, so one update covers both
  function setRecipeImage(slug, image) {
    const r = state.recipes.find((x) => x.slug === slug);
    if (r) r.image = image;
    if (state.current && state.current.slug === slug) drawPhoto();
  }

  function drawPhoto() {
    const box = document.getElementById('photo');
    const r = state.current;
    if (!box || !r) return;
    box.innerHTML = r.image ? `<img class="photo hero" src="${esc(r.image)}" alt="${esc(r.title)}" decoding="async">` : '';
  }

  // Importers and admins can edit the recipe that's open, and add, change or remove its photo
  function drawPhotoTools() {
    const box = document.getElementById('photo-tools');
    const r = state.current;
    if (!box || !r) return;
    const p = state.photo;
    const msg = p.busy ? '<p class="working">Saving the photo…</p>'
      : p.msg && p.msg.slug === r.slug ? `<p class="${p.msg.ok ? 'form-ok' : 'form-error'}">${esc(p.msg.text)}</p>` : '';
    const dis = p.busy ? ' disabled' : '';
    box.innerHTML = (canImport() ? `
      <div class="photo-tools">
        <a class="button secondary" href="#/edit/${encodeURIComponent(r.slug)}">Edit recipe</a>
        <button class="button secondary" data-action="pick-file" data-for="photo-file"${dis}>${r.image ? 'Change photo' : 'Add photo'}</button>
        ${r.image ? `<button class="button secondary" data-action="photo-remove"${dis}>Remove photo</button>` : ''}
        <input id="photo-file" type="file" accept="image/*" data-action="photo-file" hidden>
      </div>` : '') + (msg ? `<div class="photo-msg" aria-live="polite">${msg}</div>` : '');
  }

  // Runs a photo change for the open recipe; the page isn't redrawn, so timers keep going
  async function photoRequest(fn) {
    const r = state.current;
    if (!r || state.photo.busy) return;
    const slug = r.slug;
    state.photo = { busy: true, msg: null };
    drawPhotoTools();
    try {
      setRecipeImage(slug, (await fn(slug)).image || '');
    } catch (e) {
      if (e.status === 401) {
        state.user = null;
        drawAccount();
      }
      state.photo.msg = { slug, text: e.status === 401 ? 'Your session ended. Sign in again to change the photo.' : e.message };
    }
    state.photo.busy = false;
    drawPhotoTools();
  }

  async function changePhoto(file) {
    const r = state.current;
    if (!file || !r) return;
    let out;
    try {
      out = await editPhoto(file);
    } catch (e) {
      state.photo.msg = { slug: r.slug, text: e.message };
      drawPhotoTools();
      return;
    }
    if (out && state.current === r) photoRequest((slug) => uploadPhoto(slug, out));
  }

  function removePhoto() {
    if (confirm('Remove the photo from this recipe?')) photoRequest((slug) => api('recipes/photo/delete', { method: 'POST', json: { slug } }));
  }

  /* ---------- sign-in & import ---------- */

  // The import service lives at /api/ (opt/nomnoms-api). Browsing never depends on it.
  async function api(path, { method = 'GET', json, form } = {}) {
    const opts = { method, headers: { 'X-Requested-With': 'nomnoms' }, credentials: 'same-origin', cache: 'no-store' };
    if (json !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(json);
    }
    if (form) opts.body = form;
    let res;
    try {
      res = await fetch('api/' + path, opts);
    } catch (e) {
      throw Object.assign(new Error("Couldn't reach the server. Check your connection."), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const msg = (data && data.error) ||
        (res.status === 404 || res.status >= 502 ? "The import service isn't available on this server." : `Request failed (HTTP ${res.status}).`);
      throw Object.assign(new Error(msg), { status: res.status, data });
    }
    return data;
  }

  async function loadUser() {
    try {
      state.user = (await api('me')).user;
    } catch (e) {
      state.user = null;
    }
    state.userKnown = true;
  }

  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const MAX_UPLOAD = 20 * 1024 * 1024;

  const METHOD_TEXT = {
    json: 'Read directly from a recipe file.',
    jsonld: 'Read from the recipe data the web page publishes. No AI was involved.',
    claude: 'Extracted by Claude. Check the amounts, units and steps against the original before saving.'
  };

  // Shared by #/import and #/admin. After signing in, route() shows the page that was asked for.
  function showSignIn(lede) {
    pageTitle('Sign in');
    app.innerHTML = `
      <section class="import">
        <a class="back" href="#/">All recipes</a>
        <h1>Sign in</h1>
        <p class="lede">${esc(lede)}</p>
        <form class="login" data-action="login">
          <label for="login-user">User name</label>
          <input id="login-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          <label for="login-pass">Password</label>
          <input id="login-pass" name="password" type="password" autocomplete="current-password" required>
          <button class="button" type="submit">Sign in</button>
          <p id="login-status" class="form-error" role="alert">${esc(state.imp.error)}</p>
          <p class="hint">Forgotten your password? Ask an admin to reset it.</p>
        </form>
      </section>`;
    document.getElementById('login-user').focus();
  }

  // #/password, and in place of #/import or #/admin while the password is temporary
  function showPassword() {
    if (!state.userKnown) {
      app.innerHTML = '<p class="status">Checking sign-in…</p>';
      return;
    }
    if (!state.user) {
      showSignIn('Sign in to change your password.');
      return;
    }
    const forced = mustChangePassword();
    pageTitle(forced ? 'Choose a password' : 'Change password');
    app.innerHTML = `
      <section class="import">
        <a class="back" href="#/">All recipes</a>
        <h1>${forced ? 'Choose your own password' : 'Change password'}</h1>
        ${forced ? '<p class="lede">Your password was set by an admin. Choose your own to carry on.</p>' : ''}
        <form class="login" data-action="password">
          <label for="pw-current">${forced ? 'Password from your admin' : 'Current password'}</label>
          <input id="pw-current" name="current" type="password" autocomplete="current-password" required data-secret>
          <label for="pw-new">New password</label>
          <input id="pw-new" name="password" type="password" minlength="12" autocomplete="new-password" required data-secret>
          <label for="pw-repeat">Repeat new password</label>
          <input id="pw-repeat" name="repeat" type="password" minlength="12" autocomplete="new-password" required data-secret>
          <p class="hint">At least 12 characters. Your other sessions will be signed out.</p>
          <button class="button" type="submit">${forced ? 'Set password' : 'Change password'}</button>
          <p id="pw-status" class="form-error" role="alert"></p>
        </form>
      </section>`;
    document.getElementById('pw-current').focus();
  }

  async function changePassword(form) {
    const f = form.elements;
    const status = document.getElementById('pw-status');
    const btn = form.querySelector('button');
    const forced = mustChangePassword();
    status.className = 'form-error';
    if (f.password.value !== f.repeat.value) {
      status.textContent = "The new passwords don't match.";
      f.repeat.value = '';
      f.repeat.focus();
      return;
    }
    btn.disabled = true;
    status.textContent = '';
    try {
      const data = await api('password', { method: 'POST', json: { current: f.current.value, password: f.password.value } });
      state.user = data.user;
      if (forced) {
        // On to the page that was asked for
        if (location.hash === '#/password') location.hash = '#/';
        else route();
        return;
      }
      form.reset();
      status.className = 'form-ok';
      status.textContent = 'Password changed. Your other sessions were signed out.';
    } catch (e) {
      if (e.status === 401) {
        state.user = null;
        state.imp.error = 'Your session ended. Sign in again.';
        route();
        return;
      }
      status.textContent = e.message;
      form.reset();
      f.current.focus();
    }
    btn.disabled = false;
  }

  function showImport() {
    if (!state.userKnown) {
      app.innerHTML = '<p class="status">Checking sign-in…</p>';
      return;
    }

    drawAccount(); // also called after the session ends mid-import, outside route()
    if (!state.user) {
      showSignIn('Sign in to import recipes.');
      return;
    }

    pageTitle('Import a recipe');
    app.innerHTML = `
      <section class="import">
        <a class="back" href="#/">All recipes</a>
        <h1>Import a recipe</h1>
        <div id="import-body"></div>
      </section>`;
    drawImport();
  }

  function drawImport() {
    const box = document.getElementById('import-body');
    if (!box) return;
    if (state.imp.draft) drawReview();
    else {
      box.innerHTML = sourcesHtml();
      setImportBusy(state.imp.busy);
    }
  }

  function sourcesHtml() {
    return `
      <p class="lede">Bring in a recipe from a file, a web page or pasted text. You'll check it before anything is saved.</p>
      <div id="imp-status" class="imp-status" aria-live="polite">${importStatusHtml()}</div>
      <div class="sources">
        <form class="source" data-action="import-file" data-drop>
          <h2>From a file</h2>
          <p class="hint">A recipe .json file, a PDF, a photo or screenshot, a saved web page, or a text file. You can also drop a file or a link here.</p>
          <input type="file" name="file" aria-label="Recipe file"
            accept=".json,.pdf,.html,.htm,.txt,.md,application/json,application/pdf,text/html,text/plain,image/jpeg,image/png,image/webp,image/gif">
          <button class="button" type="submit">Import file</button>
        </form>
        <form class="source" data-action="import-url">
          <h2>From a web page</h2>
          <p class="hint">Most recipe sites publish their recipes in a standard format, which imports exactly.</p>
          <input type="url" name="url" placeholder="https://" aria-label="Web page address" required>
          <button class="button" type="submit">Import page</button>
        </form>
        <form class="source" data-action="import-text">
          <h2>Paste text</h2>
          <p class="hint">Copy a recipe from an email, a note or a message.</p>
          <textarea name="text" rows="6" aria-label="Recipe text" required></textarea>
          <button class="button" type="submit">Import text</button>
        </form>
      </div>`;
  }

  function importStatusHtml() {
    if (state.imp.busy) return '<p class="working">Reading the recipe… PDFs and photos can take up to a minute.</p>';
    if (state.imp.error) return `<p class="form-error">${esc(state.imp.error)}</p>`;
    return '';
  }

  function setImportBusy(busy) {
    state.imp.busy = busy;
    const status = document.getElementById('imp-status');
    if (status) status.innerHTML = importStatusHtml();
    app.querySelectorAll('.sources button, .sources input, .sources textarea').forEach((el) => { el.disabled = busy; });
  }

  async function runImport(body) {
    if (state.imp.busy) return;
    state.imp.error = '';
    setImportBusy(true);
    try {
      const data = await api('import', body instanceof FormData ? { method: 'POST', form: body } : { method: 'POST', json: body });
      state.imp.draft = newDraft('import', data.slug || '', data.recipe || {}, {
        method: data.method,
        errors: data.errors || [],
        warnings: data.warnings || []
      });
      // The photo the web page publishes, offered for review like the rest
      if (data.photo) setDraftPhoto(base64Blob(data.photo.data, data.photo.mediaType));
    } catch (e) {
      if (e.status === 401) state.user = null;
      state.imp.error = e.message;
    }
    state.imp.busy = false;
    if (location.hash === '#/import') showImport();
  }

  function clearImport() {
    const d = state.imp.draft;
    if (d && d.photo) URL.revokeObjectURL(d.photo.url);
    state.imp = { busy: false, error: '', draft: null };
  }

  // `source` is the original file, kept so "Adjust photo" can recrop it from scratch.
  // A chosen file opens the editor; the web page's photo is used whole until adjusted.
  async function setDraftPhoto(source, edit) {
    const d = state.imp.draft;
    if (!d || !source) return;
    d.photoMsg = '';
    let out;
    try {
      if (edit) {
        out = await editPhoto(source);
        if (!out) return; // cancelled: keep what was there
      } else {
        d.photoBusy = true;
        drawDraftPhoto();
        out = await preparePhoto(source);
      }
    } catch (e) {
      d.photoMsg = e.message;
    }
    d.photoBusy = false;
    if (state.imp.draft !== d) return; // started over meanwhile
    if (out) {
      if (d.photo) URL.revokeObjectURL(d.photo.url);
      d.photo = { blob: out, url: URL.createObjectURL(out), source };
    }
    drawDraftPhoto();
  }

  function removeDraftPhoto() {
    const d = state.imp.draft;
    if (!d || !d.photo) return;
    URL.revokeObjectURL(d.photo.url);
    d.photo = null;
    drawDraftPhoto();
  }

  function draftPhotoHtml(d) {
    const dis = d.photoBusy || d.saving ? ' disabled' : '';
    return `
      ${d.photo ? `<img class="photo draft" src="${esc(d.photo.url)}" alt="The photo that will be saved with the recipe">`
        : '<p class="hint">Optional. A photo of the finished dish, shown at the top of the recipe.</p>'}
      <div class="actions">
        <button class="button secondary" data-action="pick-file" data-for="imp-photo-file"${dis}>${d.photo ? 'Choose another photo' : 'Choose photo'}</button>
        ${d.photo ? `<button class="button secondary" data-action="imp-photo-edit"${dis}>Adjust photo</button>
          <button class="button secondary" data-action="imp-photo-remove"${dis}>Remove photo</button>` : ''}
        <input id="imp-photo-file" type="file" accept="image/*" data-action="imp-photo-file" hidden>
      </div>
      ${d.photoBusy ? '<p class="working">Preparing the photo…</p>' : d.photoMsg ? `<p class="form-error">${esc(d.photoMsg)}</p>` : ''}`;
  }

  function drawDraftPhoto() {
    const box = document.getElementById('imp-photo');
    const d = state.imp.draft;
    if (box && d) box.innerHTML = draftPhotoHtml(d);
  }

  function importFile(file) {
    if (!file) {
      state.imp.error = 'Choose a file first.';
      setImportBusy(false);
      return;
    }
    if (file.size > MAX_UPLOAD) {
      state.imp.error = 'Files must be under 20 MB.';
      setImportBusy(false);
      return;
    }
    const form = new FormData();
    form.append('file', file, file.name);
    runImport(form);
  }

  /* ---------- review & edit ---------- */

  // An import draft and an edit draft look the same. `view` is 'preview' (imports start
  // there), 'form' or 'json'. In the JSON view `text` is what's being edited, otherwise
  // `form`; switching views converts one into the other.
  function newDraft(kind, slug, recipe, extra) {
    return {
      kind,
      slug,
      view: kind === 'import' ? 'preview' : state.editor,
      text: JSON.stringify(recipe, null, 2),
      form: recipeToForm(recipe),
      errors: [],
      warnings: [],
      viewMsg: '',
      saveMsg: '',
      conflict: false, // import: a recipe with that file name exists
      changed: false, // edit: someone saved the recipe after it was opened
      dirty: false,
      saving: false,
      photo: null,
      photoBusy: false,
      photoMsg: '',
      ...extra
    };
  }

  const editSlug = () => {
    const m = location.hash.match(/^#\/edit\/(.+)$/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  };
  const currentDraft = () => (editSlug() !== null ? state.edit : state.imp.draft);

  function parseRecipeText(text) {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The recipe must be a JSON object.');
    return raw;
  }

  const draftRecipe = (d) => (d.view === 'form' ? formToRecipe(d.form) : parseRecipeText(d.text));

  // The form holds everything as text, the way it's typed. Fields it has no box for, such
  // as `image` or the author's own, are kept in `extra` and written back unchanged.
  const FORM_FIELDS = ['title', 'description', 'servings', 'time', 'tags', 'source', 'ingredients', 'steps', 'notes'];
  const txt = (v) => (v === null || v === undefined ? '' : String(v));
  const blank = {
    groups: () => ({ name: '', items: [blank.items()] }),
    items: () => ({ amount: '', unit: '', name: '', note: '' }),
    steps: () => ({ title: '', text: '', minutes: '' }),
    notes: () => ''
  };

  function recipeToForm(raw) {
    const extra = {};
    for (const [k, v] of Object.entries(raw)) if (!FORM_FIELDS.includes(k)) extra[k] = v;
    const groups = normalizeGroups(raw.ingredients).map((g) => ({
      name: g.name,
      items: g.items.map((it) => ({ amount: txt(it.amount), unit: txt(it.unit), name: it.name, note: txt(it.note) }))
    }));
    return {
      title: txt(raw.title),
      description: txt(raw.description),
      servings: txt(raw.servings),
      time: txt(raw.time),
      tags: Array.isArray(raw.tags) ? raw.tags.join(', ') : '',
      source: txt(raw.source),
      groups: groups.length ? groups : [blank.groups()],
      steps: (Array.isArray(raw.steps) ? raw.steps : []).map((s) =>
        typeof s === 'string'
          ? { title: '', text: s, minutes: '' }
          : { title: txt(s.title), text: txt(s.text), minutes: Number(s.timer) > 0 ? trim(Number(s.timer) / 60, 2) : '' }),
      notes: Array.isArray(raw.notes) ? raw.notes.map(txt) : raw.notes ? [txt(raw.notes)] : [],
      extra
    };
  }

  // Back to the recipe format, in the order docs/recipe-format.md lists the fields, leaving
  // out empty boxes and rows. The server checks the result again when it's saved.
  function formToRecipe(f) {
    const t = (v) => txt(v).trim();
    const r = {};
    for (const k of ['title', 'description']) if (t(f[k])) r[k] = t(f[k]);
    if (t(f.servings)) r.servings = Number(t(f.servings)) || t(f.servings);
    if (t(f.time)) r.time = t(f.time);
    const tags = f.tags.split(',').map(t).filter(Boolean);
    if (tags.length) r.tags = tags;
    if (t(f.source)) r.source = t(f.source);
    if (f.extra.image !== undefined) r.image = f.extra.image;

    const item = (it) => {
      const [amount, unit, name, note] = [t(it.amount), t(it.unit), t(it.name), t(it.note)];
      if (!amount && !unit && !name && !note) return null;
      const o = {};
      if (amount) o.amount = /^\d+(?:\.\d+)?$/.test(amount) ? Number(amount) : amount;
      if (unit) o.unit = unit;
      o.name = name;
      if (note) o.note = note;
      return o;
    };
    const ingredients = f.groups.flatMap((g) => {
      const items = g.items.map(item).filter(Boolean);
      if (t(g.name)) return [{ group: t(g.name), items }];
      return items; // without a heading, the items sit loose in the list
    });
    if (ingredients.length) r.ingredients = ingredients;

    const steps = f.steps.map((s) => {
      const [title, text] = [t(s.title), t(s.text)];
      const timer = Math.round(Number(t(s.minutes)) * 60);
      const hasTimer = Number.isFinite(timer) && timer > 0;
      if (!title && !text && !hasTimer) return null;
      if (!title && !hasTimer) return text;
      const o = {};
      if (title) o.title = title;
      o.text = text;
      if (hasTimer) o.timer = timer;
      return o;
    }).filter((s) => s !== null);
    if (steps.length) r.steps = steps;

    const notes = f.notes.map(t).filter(Boolean);
    if (notes.length) r.notes = notes;
    for (const [k, v] of Object.entries(f.extra)) if (k !== 'image') r[k] = v;
    return r;
  }

  // Into #import-body, on both the import and the edit page
  function drawReview() {
    const box = document.getElementById('import-body');
    const d = currentDraft();
    if (!box || !d) return;
    box.innerHTML = reviewHtml(d);
    drawPreview();
  }

  function reviewHtml(d) {
    const intro = d.kind === 'import' ? `<p class="method method-${esc(d.method)}">${esc(METHOD_TEXT[d.method] || '')}</p>` : '';
    const body = d.view === 'preview' ? `
      <section class="preview solo" aria-labelledby="pv-h">
        <h2 id="pv-h">Preview</h2>
        <div id="preview"></div>
        <div class="actions"><button class="button secondary" data-action="draft-view" data-view="${state.editor}">Edit before saving</button></div>
      </section>` : `
      <div class="editor-switch">
        <span class="field-label" id="es-h">Edit with</span>
        <div class="seg" role="group" aria-labelledby="es-h">
          <button data-action="draft-view" data-view="form" aria-pressed="${d.view === 'form'}">Form</button>
          <button data-action="draft-view" data-view="json" aria-pressed="${d.view === 'json'}">JSON</button>
        </div>
      </div>
      <p id="view-msg" class="form-error" role="alert">${esc(d.viewMsg)}</p>
      <div class="review editing">
        <section class="preview" aria-labelledby="pv-h">
          <h2 id="pv-h">Preview</h2>
          <div id="preview"></div>
        </section>
        <section class="edit" aria-labelledby="ed-h">
          <h2 id="ed-h">Recipe</h2>
          ${d.view === 'form' ? `<div id="form-editor" class="form-editor">${formHtml(d.form)}</div>` : `
            <p class="hint">The recipe file itself. Fix anything that's wrong here, then update the preview. The format is described in docs/recipe-format.md.</p>
            <textarea id="imp-json" spellcheck="false" autocapitalize="none" rows="22" aria-labelledby="ed-h">${esc(d.text)}</textarea>
            <button class="button secondary" data-action="imp-preview">Update preview</button>`}
        </section>
      </div>`;
    const bar = d.kind === 'import' ? `
        <h2 class="field-label" id="ph-h">Photo</h2>
        <div id="imp-photo" class="imp-photo" role="group" aria-labelledby="ph-h">${draftPhotoHtml(d)}</div>
        <label for="imp-slug">File name</label>
        <div class="slug-field"><input id="imp-slug" value="${esc(d.slug)}" autocapitalize="none" spellcheck="false"><span>.json</span></div>
        <p class="hint">Lowercase letters, numbers and hyphens. This becomes the recipe's address, so pick it once.</p>
        <div class="actions">
          <button class="button" data-action="imp-save"${d.saving ? ' disabled' : ''}>Save recipe</button>
          <button class="button secondary" data-action="imp-reset">Start over</button>
        </div>` : `
        <p class="field-label">File name</p>
        <p>${esc(d.slug)}.json</p>
        <p class="hint">The file name is the recipe's address, so it stays the same. Change the photo on the recipe page.</p>
        <div class="actions">
          <button class="button" data-action="imp-save"${d.saving ? ' disabled' : ''}>Save changes</button>
          <button class="button secondary" data-action="edit-discard">Discard changes</button>
        </div>`;
    return `
      ${intro}
      <div id="imp-messages">${messagesHtml(d)}</div>
      ${body}
      <div class="save-bar">
        ${bar}
        <div id="save-status" aria-live="polite">${saveStatusHtml(d)}</div>
      </div>`;
  }

  function setView(view) {
    const d = currentDraft();
    if (!d || d.view === view) return;
    if (view === 'form') {
      try {
        if (d.view === 'json') d.form = recipeToForm(parseRecipeText(d.text));
      } catch (e) {
        d.viewMsg = `The JSON can't be shown as a form until it's fixed: ${e.message}`;
        const msg = document.getElementById('view-msg');
        if (msg) msg.textContent = d.viewMsg;
        return;
      }
    } else if (view === 'json' && d.view === 'form') {
      d.text = JSON.stringify(formToRecipe(d.form), null, 2);
    }
    d.view = view;
    d.viewMsg = '';
    state.editor = view;
    setPref('editor', view);
    drawReview();
    const first = app.querySelector('#form-editor [data-f], #imp-json');
    if (first) first.focus();
  }

  /* ---------- the form editor ---------- */

  const UNIT_OPTIONS = ['tsp', 'tbsp', 'cup', 'fl oz', 'oz', 'lb', 'g', 'kg', 'ml', 'l'];

  function formHtml(f) {
    const box = (label, path, value, attrs = '') =>
      `<label class="fe-field"><span>${label}</span><input data-f="${path}" value="${esc(value)}"${attrs}></label>`;
    // ↑ ↓ × for one entry of a list; `g` is the group for ingredients
    const tools = (list, i, n, what, g) => {
      const at = `data-list="${list}" data-i="${i}"${g === undefined ? '' : ` data-g="${g}"`}`;
      return `
        <div class="fe-tools">
          <button type="button" class="fe-tool" data-action="form-move" data-dir="-1" ${at} aria-label="Move ${what} up"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="fe-tool" data-action="form-move" data-dir="1" ${at} aria-label="Move ${what} down"${i === n - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" class="fe-tool" data-action="form-remove" ${at} aria-label="Remove ${what}">×</button>
        </div>`;
    };

    const groups = f.groups.map((g, gi) => `
      <div class="fe-group">
        <div class="fe-group-head">
          ${box('Group heading', `groups.${gi}.name`, g.name, ' placeholder="Optional, such as For the sauce"')}
          ${tools('groups', gi, f.groups.length, `group ${gi + 1}`)}
        </div>
        ${g.items.map((it, i) => {
          const what = `ingredient ${i + 1}${f.groups.length > 1 ? ` in group ${gi + 1}` : ''}`;
          const p = `groups.${gi}.items.${i}`;
          return `
          <div class="fe-item">
            ${box('Amount', `${p}.amount`, it.amount, ' inputmode="decimal"')}
            ${box('Unit', `${p}.unit`, it.unit, ' list="fe-units" autocapitalize="none"')}
            ${box('Ingredient', `${p}.name`, it.name)}
            ${box('Note', `${p}.note`, it.note, ' placeholder="Optional, such as finely chopped"')}
            ${tools('items', i, g.items.length, what, gi)}
          </div>`;
        }).join('')}
        <button type="button" class="button secondary" data-action="form-add" data-list="items" data-g="${gi}">Add ingredient</button>
      </div>`).join('');

    const steps = f.steps.map((s, i) => `
      <div class="fe-step">
        <div class="fe-step-head">
          <span class="fe-num">${i + 1}</span>
          ${box('Heading', `steps.${i}.title`, s.title, ' placeholder="Optional"')}
          ${box('Timer (minutes)', `steps.${i}.minutes`, s.minutes, ' type="number" min="0" step="any" inputmode="decimal"')}
          ${tools('steps', i, f.steps.length, `step ${i + 1}`)}
        </div>
        <label class="fe-field"><span>Instruction</span><textarea data-f="steps.${i}.text" rows="3">${esc(s.text)}</textarea></label>
      </div>`).join('');

    const notes = f.notes.map((n, i) => `
      <div class="fe-note">
        <label class="fe-field"><span>Note ${i + 1}</span><textarea data-f="notes.${i}" rows="2">${esc(n)}</textarea></label>
        ${tools('notes', i, f.notes.length, `note ${i + 1}`)}
      </div>`).join('');

    return `
      <fieldset>
        <legend>About the recipe</legend>
        ${box('Title', 'title', f.title)}
        ${box('Description', 'description', f.description, ' placeholder="One line, shown under the title"')}
        <div class="fe-pair">
          ${box('Servings', 'servings', f.servings, ' type="number" min="1" step="1" inputmode="numeric"')}
          ${box('Total time', 'time', f.time, ' placeholder="1 hr 15 min"')}
        </div>
        ${box('Tags', 'tags', f.tags, ' placeholder="dinner, vegetarian" autocapitalize="none"')}
        ${box('Source', 'source', f.source, ' placeholder="A web address, a book or a person"')}
      </fieldset>
      <fieldset>
        <legend>Ingredients</legend>
        <p class="hint">Amounts are for the servings above and scale with them. Write fractions as 1/2 or 1 1/2.</p>
        <datalist id="fe-units">${UNIT_OPTIONS.map((u) => `<option value="${u}">`).join('')}</datalist>
        ${groups}
        <button type="button" class="button secondary" data-action="form-add" data-list="groups">Add group</button>
      </fieldset>
      <fieldset>
        <legend>Method</legend>
        <p class="hint">Keep quantities out of the instructions: they don't scale with the servings.</p>
        ${steps}
        <button type="button" class="button secondary" data-action="form-add" data-list="steps">Add step</button>
      </fieldset>
      <fieldset>
        <legend>Notes</legend>
        ${notes}
        <button type="button" class="button secondary" data-action="form-add" data-list="notes">Add note</button>
      </fieldset>`;
  }

  // Follows a data-f path such as "groups.0.items.2.amount"
  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    for (const k of keys) obj = obj[k];
    obj[last] = value;
  }

  // The list an add, move or remove button works on, and the path of its entries
  function formList(f, el) {
    const g = Number(el.dataset.g);
    return el.dataset.list === 'items'
      ? { list: f.groups[g].items, path: `groups.${g}.items` }
      : { list: f[el.dataset.list], path: el.dataset.list };
  }

  const FOCUS_FIELD = { groups: 'name', items: 'amount', steps: 'text', notes: '' };

  function formChange(el) {
    const d = currentDraft();
    if (!d || d.view !== 'form') return;
    const { list, path } = formList(d.form, el);
    const kind = el.dataset.list;
    const i = Number(el.dataset.i);
    let focus;
    if (el.dataset.action === 'form-add') {
      list.push(blank[kind]());
      focus = list.length - 1;
    } else if (el.dataset.action === 'form-move') {
      const j = i + Number(el.dataset.dir);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      focus = j;
    } else {
      if (kind === 'groups' && list[i].items.some((it) => it.name.trim()) && !confirm('Remove this group and its ingredients?')) return;
      list.splice(i, 1);
    }
    d.dirty = true;
    const box = document.getElementById('form-editor');
    if (box) box.innerHTML = formHtml(d.form);
    drawPreview();
    // Keeps the keyboard where it was: on the new or moved entry, or on what's left
    let target = null;
    if (focus !== undefined) {
      if (el.dataset.action === 'form-move') target = app.querySelector(`[data-action="form-move"][data-dir="${el.dataset.dir}"][data-list="${kind}"][data-i="${focus}"]${kind === 'items' ? `[data-g="${el.dataset.g}"]` : ''}`);
      if (!target || target.disabled) {
        const field = FOCUS_FIELD[kind];
        target = app.querySelector(`[data-f="${path}.${focus}${field ? '.' + field : ''}"]`);
      }
    } else {
      target = app.querySelector(`[data-action="form-add"][data-list="${kind}"]${kind === 'items' ? `[data-g="${el.dataset.g}"]` : ''}`) ||
        app.querySelector('[data-action="form-add"][data-list="groups"]');
    }
    if (target) target.focus();
  }

  function messagesHtml(d) {
    const list = (items) => `<ul>${items.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
    return (d.errors.length ? `<div class="notice error"><p><strong>Fix these before saving:</strong></p>${list(d.errors)}</div>` : '') +
      (d.warnings.length ? `<div class="notice"><p><strong>Worth checking:</strong></p>${list(d.warnings)}</div>` : '');
  }

  function saveStatusHtml(d) {
    if (d.saving) return '<p class="working">Saving…</p>';
    if (d.conflict) {
      return `<p class="form-error">A recipe called "${esc(d.slug)}" already exists. Change the file name, or
        <button class="link-button" data-action="imp-overwrite">replace the existing recipe</button>.</p>`;
    }
    if (d.changed) {
      return `<p class="form-error">${esc(d.saveMsg)} You can
        <button class="link-button" data-action="edit-reload">load the saved version</button>, which loses your changes, or
        <button class="link-button" data-action="imp-overwrite">save yours over it</button>.</p>`;
    }
    return d.saveMsg ? `<p class="form-error">${esc(d.saveMsg)}</p>` : '';
  }

  function drawSaveStatus() {
    const d = currentDraft();
    const box = document.getElementById('save-status');
    if (box && d) box.innerHTML = saveStatusHtml(d);
    const btn = app.querySelector('[data-action="imp-save"]');
    if (btn && d) btn.disabled = d.saving;
  }

  function drawPreview() {
    const box = document.getElementById('preview');
    const d = currentDraft();
    if (!box || !d) return;
    let r;
    try {
      r = normalizeRecipe(draftRecipe(d), (d.slug || 'recipe') + '.json');
    } catch (e) {
      box.innerHTML = `<p class="form-error">The JSON can't be read: ${esc(e.message)}</p>`;
      return;
    }
    box.innerHTML = `
      <h3 class="pv-title">${esc(r.title)}</h3>
      ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
      <p class="facts"><span>Serves ${esc(r.servings)}</span>${r.time ? `<span>${esc(r.time)}</span>` : ''}${r.tags.length ? `<span>${r.tags.map(esc).join(', ')}</span>` : ''}</p>
      ${r.groups.map((g) => `
        <div class="group">
          ${g.name ? `<h4>${esc(g.name)}</h4>` : ''}
          <ul>${g.items.map((it) => `<li><span class="amt">${esc(amountText(it, 1, state.units))}</span> ${esc(it.name)}${it.note ? `<span class="note">, ${esc(it.note)}</span>` : ''}</li>`).join('')}</ul>
        </div>`).join('')}
      <ol class="pv-steps">${r.steps.map((s) => `<li>${s.title ? `<strong>${esc(s.title)}.</strong> ` : ''}${esc(s.text)}${s.timer ? ` <span class="note">(timer: ${esc(fmtDuration(s.timer))})</span>` : ''}</li>`).join('')}</ol>
      ${r.notes.length ? `<h4>Notes</h4><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${r.source ? `<p class="source">Source: ${esc(r.source)}</p>` : ''}`;
  }

  /* ---------- editing a saved recipe ---------- */

  async function showEdit(slug) {
    if (!state.userKnown) {
      app.innerHTML = '<p class="status">Checking sign-in…</p>';
      return;
    }
    drawAccount();
    if (!state.user) {
      showSignIn('Sign in to edit recipes.');
      return;
    }

    const saved = state.recipes.find((x) => x.slug === slug);
    pageTitle(saved ? `Edit ${saved.title}` : 'Edit recipe');
    app.innerHTML = `
      <section class="import">
        <a class="back" href="#/r/${encodeURIComponent(slug)}">Back to the recipe</a>
        <h1>Edit recipe</h1>
        <div id="import-body"></div>
      </section>`;
    if (state.edit && state.edit.slug === slug) {
      drawReview();
      return;
    }

    // Read from the service rather than recipes/, for the version that detects other saves
    state.edit = null;
    const box = document.getElementById('import-body');
    box.innerHTML = '<p class="status">Loading the recipe…</p>';
    let data;
    try {
      data = await api('recipes/file?slug=' + encodeURIComponent(slug));
    } catch (e) {
      if (editSlug() !== slug) return; // gone somewhere else meanwhile
      if (e.status === 401) {
        state.user = null;
        showEdit(slug);
        return;
      }
      const missing = e.status === 404 && e.data && e.data.error;
      box.innerHTML = `<div class="notice"><p><strong>${missing ? "That recipe doesn't exist." : "The recipe couldn't be loaded."}</strong></p>
        <p>${esc(missing ? 'It may have been renamed or removed.' : e.message)}</p></div>`;
      return;
    }
    if (editSlug() !== slug) return;
    state.edit = newDraft('edit', slug, data.recipe, { version: data.version });
    drawReview();
  }

  function discardEdit() {
    const d = state.edit;
    if (!d || (d.dirty && !confirm('Discard your changes to this recipe?'))) return;
    state.edit = null;
    location.hash = '#/r/' + encodeURIComponent(d.slug);
  }

  function reloadEdit() {
    const d = state.edit;
    if (!d || !confirm('Load the saved version? Your changes will be lost.')) return;
    state.edit = null;
    showEdit(d.slug);
  }

  // `force`: for an import, replace the recipe with that file name; for an edit, save over
  // changes someone else made since it was opened
  async function saveDraft(force) {
    const d = currentDraft();
    if (!d || d.saving) return;
    d.conflict = false;
    d.changed = false;
    d.saveMsg = '';

    let recipe;
    try {
      recipe = draftRecipe(d);
    } catch (e) {
      d.saveMsg = `The JSON can't be read: ${e.message}`;
      drawSaveStatus();
      return;
    }
    const slug = d.slug.trim();
    if (!SLUG_RE.test(slug) || slug === 'index') {
      d.saveMsg = 'Use lowercase letters, numbers and single hyphens for the file name, such as "garlic-tomato-spaghetti".';
      drawSaveStatus();
      return;
    }

    if (d.photoBusy) {
      d.saveMsg = 'Wait for the photo to finish preparing.';
      drawSaveStatus();
      return;
    }

    const body = d.kind === 'edit'
      ? { slug, recipe, overwrite: true, ...(force === true ? {} : { version: d.version }) }
      : { slug, recipe, overwrite: force === true };
    d.saving = true;
    drawSaveStatus();
    try {
      await api('recipes', { method: 'POST', json: body });
      // The recipe is saved now, whatever happens to the photo
      if (d.photo) {
        try {
          await uploadPhoto(slug, d.photo.blob);
          state.photo.msg = null;
        } catch (e) {
          state.photo.msg = { slug, text: `The recipe was saved, but the photo couldn't be added: ${e.message} Try again from here.` };
        }
      }
      if (d.kind === 'edit') state.edit = null;
      else clearImport();
      await loadRecipes();
      location.hash = '#/r/' + encodeURIComponent(slug);
      return;
    } catch (e) {
      d.saving = false;
      if (e.status === 409 && e.data && e.data.changed) {
        d.changed = true;
        d.saveMsg = e.message;
      } else if (e.status === 409) d.conflict = true;
      else if (e.status === 401) {
        state.user = null;
        state.imp.error = `Your session ended. Sign in again; your ${d.kind === 'edit' ? 'changes are' : 'draft is'} kept.`;
        if (d.kind === 'edit') showEdit(slug);
        else showImport();
        return;
      } else {
        d.saveMsg = e.message;
        if (e.status === 422 && e.data && e.data.errors) {
          d.errors = e.data.errors;
          d.warnings = e.data.warnings || [];
          const m = document.getElementById('imp-messages');
          if (m) m.innerHTML = messagesHtml(d);
        }
      }
    }
    drawSaveStatus();
  }

  async function login(form) {
    const status = document.getElementById('login-status');
    const btn = form.querySelector('button');
    btn.disabled = true;
    status.textContent = '';
    try {
      const data = await api('login', { method: 'POST', json: { username: form.elements.username.value, password: form.elements.password.value } });
      state.user = data.user;
      state.imp.error = '';
      route();
    } catch (e) {
      status.textContent = e.message;
      btn.disabled = false;
      form.elements.password.value = '';
      form.elements.password.focus();
    }
  }

  async function logout() {
    try { await api('logout', { method: 'POST' }); } catch (e) { /* signed out locally anyway */ }
    state.user = null;
    clearImport();
    state.edit = null;
    state.admin = null;
    if (isAccountPage()) location.hash = '#/';
    else route(); // signed out from a page anyone can see: no hash change, so redraw directly
  }

  /* ---------- admin ---------- */

  // Admins only (the server checks too). state.admin holds what the server sent plus
  // `look`, the appearance as edited on the page, which is previewed live until saved.

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const ROLE_TEXT = { admin: 'Admin', importer: 'Importer' };

  function showAdmin() {
    if (!state.userKnown) {
      app.innerHTML = '<p class="status">Checking sign-in…</p>';
      return;
    }
    if (!state.user) {
      showSignIn('Sign in to manage the site.');
      return;
    }
    pageTitle('Admin');
    if (!isAdmin()) {
      app.innerHTML = `
        <section class="import admin">
          <a class="back" href="#/">All recipes</a>
          <h1>Admin</h1>
          <div class="notice"><p>This page is for admins. Ask an admin if something needs changing.</p></div>
        </section>`;
      return;
    }
    app.innerHTML = `
      <section class="import admin">
        <a class="back" href="#/">All recipes</a>
        <h1>Admin</h1>
        <div id="admin-body"><p class="status">Loading settings…</p></div>
      </section>`;
    loadAdmin();
  }

  async function loadAdmin() {
    try {
      const [settings, users] = await Promise.all([api('admin/settings'), api('admin/users')]);
      state.admin = { settings, users: users.users, look: clone(settings.appearance), resetFor: null };
      drawAdmin();
    } catch (e) {
      if (e.status === 401 || e.status === 403) return adminError(e);
      const body = document.getElementById('admin-body');
      if (body) body.innerHTML = `<div class="notice error"><p>${esc(e.message)}</p></div>`;
    }
  }

  // Signed out, or no longer an admin: find out who we are now and redraw.
  function adminError(e, section) {
    if (e.status === 401 || e.status === 403) {
      if (e.status === 401) state.imp.error = 'Your session ended. Sign in again.';
      state.admin = null;
      loadUser().then(() => { if (location.hash === '#/admin') route(); });
      return;
    }
    setMsg(section, e.message);
  }

  function setMsg(section, text, ok) {
    const box = document.getElementById('msg-' + section);
    if (box) box.innerHTML = text ? `<p class="${ok ? 'form-ok' : 'form-error'}">${esc(text)}</p>` : '';
  }

  // Runs a request with the form's buttons disabled; errors land in the section's message line.
  async function adminRequest(form, section, fn) {
    const buttons = form ? [...form.querySelectorAll('button')] : [];
    buttons.forEach((b) => { b.disabled = true; });
    setMsg(section, '');
    try {
      await fn();
    } catch (e) {
      adminError(e, section);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  function drawAdmin() {
    const body = document.getElementById('admin-body');
    if (!body || !state.admin) return;
    body.innerHTML = `
      <section class="admin-section" aria-labelledby="ad-look-h"><h2 id="ad-look-h">Appearance</h2><div id="admin-look"></div></section>
      <section class="admin-section" aria-labelledby="ad-ai-h"><h2 id="ad-ai-h">Claude</h2><div id="admin-ai"></div></section>
      <section class="admin-section" aria-labelledby="ad-users-h"><h2 id="ad-users-h">Users</h2><div id="admin-users"></div></section>`;
    drawLook();
    drawAi();
    drawUsers();
  }

  /* appearance */

  function drawLook() {
    const box = document.getElementById('admin-look');
    const a = state.admin;
    if (!box || !a) return;
    const o = a.settings.options;
    const look = a.look;
    const image = look.favicon.type === 'image';
    const options = (map, selected) => Object.keys(map)
      .map((k) => `<option value="${esc(k)}"${k === selected ? ' selected' : ''}>${esc(map[k].label)}</option>`).join('');
    const swatches = (scheme) => Object.keys(o.colors).map((k) => `
      <label class="swatch"><input type="color" name="${scheme}:${esc(k)}" value="${esc(look.colors[scheme][k])}"><span>${esc(o.colors[k])}</span></label>`).join('');
    const sample = (c) => `<span class="theme-sample" style="background:${esc(c.bg)};color:${esc(c.ink)}">Aa<span style="background:${esc(c.accent)}"></span></span>`;
    const themes = Object.keys(o.themes).map((k) => `
      <label class="theme-card"><input type="radio" name="theme" value="${esc(k)}"${k === look.theme ? ' checked' : ''}>
        <span class="theme-samples">${sample(o.themes[k].colors.light)}${sample(o.themes[k].colors.dark)}</span>
        <span>${esc(o.themes[k].label)}</span></label>`).join('');

    box.innerHTML = `
      <p class="hint">Changes show on this page as you make them; colours preview in the mode your device is using. Visitors see them once you save.</p>
      <form class="admin-form" data-action="admin-look">
        <label for="ad-name">Site name</label>
        <input id="ad-name" name="siteName" maxlength="60" required value="${esc(look.siteName)}">
        <p class="hint">Shown as the home page heading and in the browser tab.</p>
        <label for="ad-emoji">Site icon</label>
        <div class="icon-row">
          ${image ? `<img class="icon-preview" src="${esc(document.getElementById('favicon').getAttribute('href'))}" alt="Current icon" width="32" height="32">` : ''}
          <input id="ad-emoji" name="emoji" value="${image ? '' : esc(look.favicon.value)}" placeholder="${image ? 'Using the uploaded image' : ''}">
        </div>
        <p class="hint">An emoji, or a letter or two.${image ? ' Leave it empty to keep the uploaded image.' : ''} To use a picture instead, upload one below.</p>
        <fieldset class="themes"><legend>Colour theme</legend>${themes}</fieldset>
        <p class="hint">Each theme has light and dark colours (shown left and right), used to match each visitor's device.</p>
        <div id="look-theme"></div>
        <details class="custom-colors"${themeChanged(look) ? ' open' : ''}>
          <summary>Customise colours</summary>
          <p class="hint">Fine-tune the chosen theme, for example to match a brand colour. Picking a theme again replaces these.</p>
          <fieldset class="colors"><legend>Colours in light mode</legend>${swatches('light')}</fieldset>
          <fieldset class="colors"><legend>Colours in dark mode</legend>${swatches('dark')}</fieldset>
        </details>
        <div id="look-contrast" aria-live="polite"></div>
        <label for="ad-heading">Heading font</label>
        <select id="ad-heading" name="heading">${options(o.fonts, look.fonts.heading)}</select>
        <label for="ad-body">Body font</label>
        <select id="ad-body" name="body">${options(o.fonts, look.fonts.body)}</select>
        <p class="hint">Fonts already on your visitors' devices, so nothing extra is downloaded. Each device shows its closest match.</p>
        <label for="ad-radius">Corners</label>
        <div class="range-row">
          <input id="ad-radius" type="range" name="radius" min="${o.radius.min}" max="${o.radius.max}" step="1" value="${look.radius}">
          <output id="ad-radius-out" for="ad-radius">${look.radius}px</output>
        </div>
        <label class="toggle"><input type="checkbox" role="switch" name="thumbnails"${look.thumbnails ? ' checked' : ''}><span>Show photos on the home page</span></label>
        <p class="hint">A small photo beside each recipe in the list that has one. Recipes without a photo look the same as before.</p>
        <div class="actions">
          <button class="button" type="submit">Save appearance</button>
          <button class="button secondary" type="button" data-action="admin-look-undo">Undo changes</button>
          <button class="button secondary" type="button" data-action="admin-look-defaults">Use the defaults</button>
        </div>
        <div id="msg-look" aria-live="polite"></div>
      </form>
      <form class="admin-form" data-action="admin-favicon">
        <label for="ad-icon-file">Upload an icon</label>
        <input id="ad-icon-file" type="file" name="file" accept=".png,.ico,.webp,image/png,image/x-icon,image/vnd.microsoft.icon,image/webp">
        <p class="hint">PNG, ICO or WebP, under 256 KB. Square images work best. It replaces the emoji as soon as it's uploaded.</p>
        <div class="actions"><button class="button secondary" type="submit">Upload icon</button></div>
        <div id="msg-icon" aria-live="polite"></div>
      </form>`;
    previewLook();
  }

  function readLook(form) {
    const f = form.elements;
    const look = clone(state.admin.look);
    look.siteName = f.siteName.value;
    const emoji = f.emoji.value.trim();
    const saved = state.admin.settings.appearance.favicon;
    look.favicon = emoji ? { type: 'emoji', value: emoji } : saved.type === 'image' ? saved : { type: 'emoji', value: '' };
    look.theme = f.theme.value;
    for (const scheme of ['light', 'dark']) {
      for (const k of Object.keys(look.colors[scheme])) look.colors[scheme][k] = f[scheme + ':' + k].value;
    }
    look.fonts = { heading: f.heading.value, body: f.body.value };
    look.radius = Number(f.radius.value);
    look.thumbnails = f.thumbnails.checked;
    return look;
  }

  // Inline variables on <html> beat theme.css, so the page shows the edits before they're saved
  function previewLook() {
    const a = state.admin;
    if (!a) return;
    const o = a.settings.options;
    const root = document.documentElement.style;
    const scheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    for (const [k, v] of Object.entries(a.look.colors[scheme])) root.setProperty('--' + k, v);
    root.setProperty('--font-heading', o.fonts[a.look.fonts.heading].stack);
    root.setProperty('--font-body', o.fonts[a.look.fonts.body].stack);
    root.setProperty('--radius', a.look.radius + 'px');
    const out = document.getElementById('ad-radius-out');
    if (out) out.textContent = a.look.radius + 'px';
    drawThemeStatus();
    drawContrast();
  }

  // Picking a theme puts its colours in the pickers, replacing any custom ones
  function useTheme(form, key) {
    const colors = state.admin.settings.options.themes[key].colors;
    for (const scheme of ['light', 'dark']) {
      for (const [k, v] of Object.entries(colors[scheme])) form.elements[scheme + ':' + k].value = v;
    }
  }

  function themeChanged(look) {
    const theme = state.admin.settings.options.themes[look.theme];
    return !theme || ['light', 'dark'].some((s) => Object.keys(theme.colors[s]).some((k) => theme.colors[s][k] !== look.colors[s][k]));
  }

  function drawThemeStatus() {
    const box = document.getElementById('look-theme');
    if (!box) return;
    const look = state.admin.look;
    const theme = state.admin.settings.options.themes[look.theme];
    box.innerHTML = theme && themeChanged(look) ? `
      <div class="theme-status">
        <p class="hint">${esc(theme.label)}, with your own colour changes.</p>
        <button class="button secondary" type="button" data-action="admin-look-theme-reset">Reset to ${esc(theme.label)}</button>
      </div>` : '';
  }

  // Same WCAG 2 formula as settings.js, which refuses to save below options.contrast.min
  function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  function drawContrast() {
    const box = document.getElementById('look-contrast');
    if (!box) return;
    const c = state.admin.settings.options.contrast;
    const issues = [];
    for (const scheme of ['light', 'dark']) {
      const colors = state.admin.look.colors[scheme];
      for (const p of c.pairs) {
        const ratio = contrastRatio(colors[p.fg], colors[p.bg]);
        if (ratio < c.warn) issues.push({ text: `${p.label}, ${scheme} mode: ${ratio.toFixed(1)}:1.`, blocked: ratio < c.min });
      }
    }
    if (!issues.length) {
      box.innerHTML = '';
      return;
    }
    const blocked = issues.some((i) => i.blocked);
    box.innerHTML = `
      <div class="notice${blocked ? ' error' : ''}">
        <p>${blocked
          ? `Some colours are too hard to read to save. Anything below ${c.min}:1 needs changing.`
          : `Some colours may be hard to read. ${c.warn}:1 or more is easier on the eyes.`}</p>
        <ul>${issues.map((i) => `<li>${esc(i.text)}${i.blocked ? ' <strong>Too low to save.</strong>' : ''}</li>`).join('')}</ul>
      </div>`;
  }

  function clearPreview() {
    const root = document.documentElement.style;
    for (const p of [...root]) if (p.startsWith('--')) root.removeProperty(p);
  }

  // Picks up the files the service just rewrote, for the rest of the site
  function reloadTheme() {
    document.getElementById('theme-css').href = 'theme/theme.css?v=' + Date.now();
    loadSite();
  }

  async function saveLook(form) {
    const look = readLook(form);
    if (look.favicon.type === 'emoji' && !look.favicon.value) {
      setMsg('look', 'Choose an emoji for the site icon, or upload an image.');
      return;
    }
    await adminRequest(form, 'look', async () => {
      const data = await api('admin/appearance', { method: 'POST', json: look });
      state.admin.settings = data;
      state.admin.look = clone(data.appearance);
      state.site.name = data.appearance.siteName;
      reloadTheme();
      drawLook();
      setMsg('look', 'Saved. Visitors see the new look the next time they load the site.', true);
    });
  }

  async function uploadFavicon(form) {
    const file = form.elements.file.files[0];
    if (!file) return setMsg('icon', 'Choose an image first.');
    if (file.size > 256 * 1024) return setMsg('icon', 'Icons must be under 256 KB.');
    const body = new FormData();
    body.append('file', file, file.name);
    await adminRequest(form, 'icon', async () => {
      const data = await api('admin/favicon', { method: 'POST', form: body });
      state.admin.settings = data;
      // Keep any unsaved edits; only the icon changes
      state.admin.look.favicon = clone(data.appearance.favicon);
      await loadSite();
      drawLook();
      setMsg('icon', 'Icon uploaded.', true);
    });
  }

  /* Claude */

  function drawAi() {
    const box = document.getElementById('admin-ai');
    const a = state.admin;
    if (!box || !a) return;
    const ai = a.settings.ai;
    const k = ai.key;
    const o = a.settings.options;
    const status = !k.set ? 'not set, so PDF, photo and pasted-text imports are switched off.'
      : `set${k.last4 ? `, ending in …${k.last4}` : ''} (${k.source === 'admin' ? 'saved on this page' : "from the server's api.env file"}).`;
    const select = (name, list, value, fallback) => `
      <select id="ad-${name}" name="${name}">
        <option value="">Server default (${esc(fallback)})</option>
        ${list.map((v) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(v)}</option>`).join('')}
      </select>`;

    // The key field is write-only: it starts empty, is never filled from the server,
    // and can't be copied out (see the copy/cut/dragstart listeners below).
    box.innerHTML = `
      <p class="hint">Claude reads PDFs, photos, pasted text and web pages without recipe data. Recipe files and most recipe sites import without it.</p>
      <form class="admin-form" data-action="admin-key" autocomplete="off">
        <p class="key-status"><strong>API key:</strong> ${esc(status)}</p>
        <label for="ad-key">${k.set ? 'Replace the key' : 'Add a key'}</label>
        <input id="ad-key" name="key" type="password" required data-secret autocomplete="off" autocapitalize="none" spellcheck="false" data-1p-ignore data-lpignore="true" placeholder="sk-ant-…">
        <p class="hint">Stored on the server and never shown again. A key saved here takes priority over api.env.</p>
        <div class="actions">
          <button class="button" type="submit">Save key</button>
          ${k.set ? '<button class="button secondary" type="button" data-action="admin-key-test">Test key</button>' : ''}
          ${k.source === 'admin' ? '<button class="button secondary" type="button" data-action="admin-key-remove">Remove key</button>' : ''}
        </div>
        <div id="msg-key" aria-live="polite"></div>
      </form>
      <form class="admin-form" data-action="admin-ai">
        <label for="ad-model">Model</label>
        ${select('model', o.models, ai.model, ai.defaults.model)}
        <label for="ad-effort">Effort</label>
        ${select('effort', o.efforts, ai.effort, ai.defaults.effort)}
        <p class="hint">Haiku costs about a twentieth of Sonnet and suits clear pages and typed text. Opus is more accurate on blurry photos and messy PDFs, at about twice the price of Sonnet. Higher effort is slower and costs more.</p>
        <div class="actions"><button class="button" type="submit">Save</button></div>
        <div id="msg-ai" aria-live="polite"></div>
      </form>`;
  }

  async function saveKey(form) {
    const input = form.elements.key;
    const key = input.value.trim();
    input.value = ''; // never left on the page
    if (!key) return;
    await adminRequest(form, 'key', async () => {
      state.admin.settings = await api('admin/api-key', { method: 'POST', json: { key } });
      drawAi();
      setMsg('key', 'Key saved. Use "Test key" to check it works.', true);
    });
  }

  async function removeKey(btn) {
    if (!confirm('Remove the API key saved on this page?')) return;
    await adminRequest(btn.closest('form'), 'key', async () => {
      state.admin.settings = await api('admin/api-key', { method: 'POST', json: { key: '' } });
      drawAi();
      setMsg('key', state.admin.settings.ai.key.set ? "Removed. The key from the server's api.env file is used instead." : 'Removed.', true);
    });
  }

  async function testKey(btn) {
    await adminRequest(btn.closest('form'), 'key', async () => {
      await api('admin/api-key/test', { method: 'POST' });
      setMsg('key', 'The key works.', true);
    });
  }

  async function saveAi(form) {
    const f = form.elements;
    await adminRequest(form, 'ai', async () => {
      state.admin.settings = await api('admin/ai', { method: 'POST', json: { model: f.model.value || null, effort: f.effort.value || null } });
      drawAi();
      setMsg('ai', 'Saved. The next Claude import uses these settings.', true);
    });
  }

  /* users */

  function drawUsers() {
    const box = document.getElementById('admin-users');
    const a = state.admin;
    if (!box || !a) return;
    const roles = a.settings.options.roles;
    const roleOptions = (selected) => roles
      .map((r) => `<option value="${esc(r)}"${r === selected ? ' selected' : ''}>${esc(ROLE_TEXT[r] || r)}</option>`).join('');

    box.innerHTML = `
      <p class="hint">Admins can use this page and import recipes. Importers can only import recipes. Visitors don't need an account.</p>
      <ul class="users">
        ${a.users.map((u) => {
          const me = u.username === state.user.username;
          const name = esc(u.username);
          return `
          <li class="user">
            <span class="user-name">${name}${me ? ' <span class="note">(you)</span>' : ''}${u.mustChangePassword ? ' <span class="note">(temporary password)</span>' : ''}</span>
            <select data-action="user-role" data-user="${name}" aria-label="Role for ${name}">${roleOptions(u.role)}</select>
            <button class="link-button" data-action="user-reset-open" data-user="${name}">Reset password</button>
            ${me ? '' : `<button class="link-button danger" data-action="user-delete" data-user="${name}">Remove</button>`}
            ${a.resetFor === u.username ? `
              <form class="user-reset" data-action="user-reset" data-user="${name}">
                <label for="ad-reset">New password for ${name}</label>
                <input id="ad-reset" name="password" type="password" minlength="12" required autocomplete="new-password" data-secret>
                <div class="actions">
                  <button class="button" type="submit">Set password</button>
                  <button class="button secondary" type="button" data-action="user-reset-cancel">Cancel</button>
                </div>
              </form>` : ''}
          </li>`;
        }).join('')}
      </ul>
      <div id="msg-users" aria-live="polite"></div>
      <form class="admin-form" data-action="user-add">
        <h3>Add a user</h3>
        <label for="ad-new-user">User name</label>
        <input id="ad-new-user" name="username" maxlength="32" required autocomplete="off" autocapitalize="none" spellcheck="false">
        <p class="hint">Lowercase letters, numbers, ".", "_" or "-".</p>
        <label for="ad-new-pass">Password</label>
        <input id="ad-new-pass" name="password" type="password" minlength="12" required autocomplete="new-password" data-secret>
        <p class="hint">At least 12 characters. Share it with them privately. They'll choose their own when they first sign in.</p>
        <label for="ad-new-role">Role</label>
        <select id="ad-new-role" name="role">${roleOptions('importer')}</select>
        <div class="actions"><button class="button" type="submit">Add user</button></div>
        <div id="msg-useradd" aria-live="polite"></div>
      </form>`;
  }

  async function changeRole(select) {
    const username = select.dataset.user;
    const role = select.value;
    const me = username === state.user.username;
    if (me && role !== 'admin' && !confirm("You'll lose access to this page. Continue?")) {
      drawUsers();
      return;
    }
    select.disabled = true;
    try {
      const data = await api('admin/users/update', { method: 'POST', json: { username, role } });
      state.admin.users = data.users;
      if (me) {
        state.user.role = role;
        if (role !== 'admin') { route(); return; }
      }
      drawUsers();
      setMsg('users', `${username} is now ${role === 'admin' ? 'an admin' : 'an importer'}.`, true);
    } catch (e) {
      drawUsers(); // put the old role back
      adminError(e, 'users');
    }
  }

  async function resetPassword(form) {
    const username = form.dataset.user;
    const password = form.elements.password.value;
    await adminRequest(form, 'users', async () => {
      const data = await api('admin/users/update', { method: 'POST', json: { username, password } });
      state.admin.users = data.users;
      state.admin.resetFor = null;
      drawUsers();
      setMsg('users', username === state.user.username
        ? 'Your password is changed. Your other sessions were signed out.'
        : `Password changed. ${username} has been signed out everywhere, and will choose their own password when they next sign in.`, true);
    });
  }

  async function deleteUser(btn) {
    const username = btn.dataset.user;
    if (!confirm(`Remove ${username}? They'll be signed out straight away.`)) return;
    await adminRequest(null, 'users', async () => {
      const data = await api('admin/users/delete', { method: 'POST', json: { username } });
      state.admin.users = data.users;
      drawUsers();
      setMsg('users', `Removed ${username}.`, true);
    });
  }

  async function addUser(form) {
    const f = form.elements;
    const username = f.username.value.trim().toLowerCase();
    await adminRequest(form, 'useradd', async () => {
      const data = await api('admin/users', { method: 'POST', json: { username, password: f.password.value, role: f.role.value } });
      state.admin.users = data.users;
      drawUsers();
      setMsg('users', `Added ${username}.`, true);
    });
  }

  /* ---------- routing ---------- */

  function leaveRecipe() {
    state.timers = {};
    if (tickId) { clearInterval(tickId); tickId = null; }
    maybeStopAlarm();
    if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
    state.wakeWanted = false;
    state.current = null;
  }

  // Pages that need the sign-in state, and are left when signing out
  const ACCOUNT_PAGES = ['#/import', '#/admin', '#/password'];
  const isAccountPage = () => ACCOUNT_PAGES.includes(location.hash) || editSlug() !== null;

  function route() {
    closeEditor(null);
    leaveRecipe();
    clearPreview();
    const m = location.hash.match(/^#\/r\/(.+)$/);
    if (m) {
      let slug = m[1];
      try { slug = decodeURIComponent(slug); } catch (e) { /* keep raw */ }
      showRecipe(slug);
    } else if (location.hash === '#/password' || (isAccountPage() && mustChangePassword())) {
      showPassword();
    } else if (editSlug() !== null) {
      showEdit(editSlug());
    } else if (location.hash === '#/import') {
      showImport();
    } else if (location.hash === '#/admin') {
      showAdmin();
    } else {
      showHome();
    }
    drawAccount();
    window.scrollTo(0, 0);
  }

  /* ---------- events ---------- */

  // The account footer sits outside #app so it's on every page; its only action is signing out
  foot.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="logout"]')) logout();
  });

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'tag':
        state.tag = state.tag === el.dataset.tag ? null : el.dataset.tag;
        drawTags();
        drawList();
        break;
      case 'clear': {
        state.query = '';
        state.tag = null;
        showHome();
        const s = document.getElementById('search');
        if (s) s.focus();
        break;
      }
      case 'serv-dec': changeServings(-1); break;
      case 'serv-inc': changeServings(1); break;
      case 'units': setUnits(el.dataset.units); break;
      case 'step': toggleStep(el); break;
      case 'timer-start': startTimer(el.dataset.i); break;
      case 'timer-stop': stopTimer(el.dataset.i); break;
      case 'pick-file': {
        const input = document.getElementById(el.dataset.for);
        if (input) input.click();
        break;
      }
      case 'photo-remove': removePhoto(); break;
      case 'imp-photo-remove': removeDraftPhoto(); break;
      case 'imp-photo-edit':
        if (state.imp.draft && state.imp.draft.photo) setDraftPhoto(state.imp.draft.photo.source, true);
        break;
      case 'crop-done': if (editor) finishCrop(el); break;
      case 'crop-reset':
        if (editor) Object.assign(editor, { cx: editor.w / 2, cy: editor.h / 2, zoom: 1 });
        drawCrop();
        break;
      case 'crop-cancel': closeEditor(null); break;
      case 'imp-preview': drawPreview(); break;
      case 'draft-view': setView(el.dataset.view); break;
      case 'form-add':
      case 'form-move':
      case 'form-remove':
        formChange(el);
        break;
      case 'edit-discard': discardEdit(); break;
      case 'edit-reload': reloadEdit(); break;
      case 'imp-save': saveDraft(false); break;
      case 'imp-overwrite': saveDraft(true); break;
      case 'imp-reset':
        clearImport();
        drawImport();
        break;
      case 'admin-look-undo':
        state.admin.look = clone(state.admin.settings.appearance);
        drawLook();
        break;
      case 'admin-look-defaults':
        state.admin.look = clone(state.admin.settings.defaults);
        drawLook();
        setMsg('look', 'Defaults loaded. Save to apply them.', true);
        break;
      case 'admin-look-theme-reset':
        state.admin.look.colors = clone(state.admin.settings.options.themes[state.admin.look.theme].colors);
        drawLook();
        break;
      case 'admin-key-test': testKey(el); break;
      case 'admin-key-remove': removeKey(el); break;
      case 'user-reset-open':
        state.admin.resetFor = el.dataset.user;
        drawUsers();
        document.getElementById('ad-reset').focus();
        break;
      case 'user-reset-cancel':
        state.admin.resetFor = null;
        drawUsers();
        break;
      case 'user-delete': deleteUser(el); break;
      default: break;
    }
  });

  app.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-action]');
    if (!form) return;
    e.preventDefault();
    switch (form.dataset.action) {
      case 'login': login(form); break;
      case 'password': changePassword(form); break;
      case 'import-file': importFile(form.elements.file.files[0]); break;
      case 'import-url': runImport({ url: form.elements.url.value.trim() }); break;
      case 'import-text': runImport({ text: form.elements.text.value }); break;
      case 'admin-look': saveLook(form); break;
      case 'admin-favicon': uploadFavicon(form); break;
      case 'admin-key': saveKey(form); break;
      case 'admin-ai': saveAi(form); break;
      case 'user-reset': resetPassword(form); break;
      case 'user-add': addUser(form); break;
      default: break;
    }
  });

  // Drag and drop onto the "From a file" box: a file, or a link dragged from another tab
  app.addEventListener('dragover', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (!zone || state.imp.busy) return;
    e.preventDefault();
    zone.classList.add('over');
  });

  app.addEventListener('dragleave', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('over');
  });

  app.addEventListener('drop', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('over');
    if (state.imp.busy) return;
    const file = e.dataTransfer.files[0];
    const link = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((l) => /^https?:\/\//i.test(l.trim()));
    if (file) importFile(file);
    else if (link) runImport({ url: link.trim() });
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.action === 'ing') {
      if (el.checked) state.checked.add(el.dataset.key);
      else state.checked.delete(el.dataset.key);
    } else if (el.dataset.action === 'wake') {
      setWake(el.checked);
    } else if (el.dataset.action === 'user-role') {
      changeRole(el);
    } else if (el.dataset.action === 'photo-file' || el.dataset.action === 'imp-photo-file') {
      // Emptied straight away, so picking the same photo again after cancelling still works
      const file = el.files[0];
      el.value = '';
      if (el.dataset.action === 'photo-file') changePhoto(file);
      else setDraftPhoto(file, true);
    }
  });

  // The photo editor's frame: drag, pinch, wheel and arrow keys
  app.addEventListener('pointerdown', (e) => {
    if (editor && e.target.closest('[data-action="crop-frame"]')) cropPointerDown(e);
  });
  app.addEventListener('pointermove', (e) => {
    if (editor) cropPointerMove(e);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    app.addEventListener(type, (e) => {
      if (editor) editor.pointers.delete(e.pointerId);
    });
  }
  app.addEventListener('wheel', (e) => {
    if (!editor || !e.target.closest('[data-action="crop-frame"]')) return;
    e.preventDefault();
    const pt = framePoint(e);
    zoomCrop(Math.exp(-e.deltaY / 500), pt.x, pt.y);
  }, { passive: false });
  app.addEventListener('keydown', (e) => {
    if (editor && e.target.closest('[data-action="crop-frame"]')) cropKey(e);
  });
  // Escape closes a dialog with a "cancel" event, which doesn't bubble
  app.addEventListener('cancel', (e) => {
    if (editor && e.target === editor.dialog) {
      e.preventDefault();
      closeEditor(null);
    }
  }, true);
  window.addEventListener('resize', drawCrop);

  // A photo missing from the server is left out rather than shown broken. Load errors
  // don't bubble, so this listens in the capture phase.
  app.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('photo')) return;
    const row = img.closest('.has-thumb');
    if (row) row.classList.remove('has-thumb');
    img.remove();
  }, true);

  // API keys and passwords typed on the admin page can't be copied or dragged back out
  for (const type of ['copy', 'cut', 'dragstart']) {
    app.addEventListener(type, (e) => {
      if (e.target instanceof Element && e.target.closest('[data-secret]')) e.preventDefault();
    });
  }

  app.addEventListener('input', (e) => {
    if (e.target.id === 'search') {
      state.query = e.target.value;
      drawList();
    } else if (e.target.id === 'crop-zoom' && editor) {
      zoomCrop(Number(e.target.value) / editor.zoom);
    } else if (e.target.id === 'imp-json' && currentDraft()) {
      currentDraft().text = e.target.value;
      currentDraft().dirty = true;
    } else if (e.target.dataset.f && currentDraft() && currentDraft().view === 'form') {
      const d = currentDraft();
      setPath(d.form, e.target.dataset.f, e.target.value);
      d.dirty = true;
      drawPreview();
    } else if (e.target.id === 'imp-slug' && state.imp.draft) {
      state.imp.draft.slug = e.target.value;
      state.imp.draft.conflict = false;
      drawSaveStatus();
    } else if (e.target.form && e.target.form.dataset.action === 'admin-look' && state.admin) {
      if (e.target.name === 'theme') useTheme(e.target.form, e.target.value);
      state.admin.look = readLook(e.target.form);
      previewLook();
    }
  });

  window.addEventListener('hashchange', route);

  Promise.all([loadRecipes(), loadSite()]).then(route);
  // Sign-in state is loaded separately so it never holds up the recipe list
  loadUser().then(() => {
    if (isAccountPage()) route();
    else drawAccount();
  });
})();
