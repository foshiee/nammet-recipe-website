(() => {
  'use strict';

  const app = document.getElementById('app');

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
    wakeWanted: false
  };

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
      source: raw.source || ''
    };
    r.search = [
      r.title, r.description, tags.join(' '),
      groups.map((g) => g.items.map((i) => i.name).join(' ')).join(' ')
    ].join(' ').toLowerCase();
    return r;
  }

  async function loadRecipes() {
    state.problems = [];
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

  /* ---------- home view ---------- */

  function showHome() {
    document.title = 'Recipes';

    if (state.loadFailed) {
      app.innerHTML = `
        <h1>Recipes</h1>
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
        <h1>Recipes</h1>
        ${n ? `<p class="count">${n} ${n === 1 ? 'recipe' : 'recipes'}</p>
        <input id="search" type="search" placeholder="Search recipes or ingredients" aria-label="Search recipes" autocomplete="off" value="${esc(state.query)}">` : ''}
        <div id="tags" class="tags"></div>
        <ul id="list" class="list"></ul>
        <p id="empty" class="empty" hidden></p>
        ${problems}
      </section>`;

    drawTags();
    drawList();
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

    list.innerHTML = shown.map((r) => `
      <li>
        <a class="row" href="#/r/${encodeURIComponent(r.slug)}">
          <span class="row-title">${esc(r.title)}</span>
          ${r.description ? `<span class="row-desc">${esc(r.description)}</span>` : ''}
          <span class="row-meta"><span>Serves ${esc(r.servings)}</span>${r.time ? `<span>${esc(r.time)}</span>` : ''}</span>
        </a>
      </li>`).join('');

    if (!state.recipes.length) {
      empty.hidden = false;
      empty.textContent = 'No recipes yet. Add a .json file to the recipes folder on the server, then reload this page.';
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
      document.title = 'Recipe not found | Recipes';
      app.innerHTML = `
        <a class="back" href="#/">All recipes</a>
        <div class="notice"><p><strong>That recipe doesn't exist.</strong></p><p>It may have been renamed or removed.</p></div>`;
      return;
    }

    state.current = r;
    state.servings = r.servings;
    state.checked = new Set();
    state.timers = {};
    document.title = r.title + ' | Recipes';

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
          <h1>${esc(r.title)}</h1>
          ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
          <p class="facts"><span>Written for ${esc(r.servings)} servings</span>${r.time ? `<span>${esc(r.time)} total</span>` : ''}</p>
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

  /* ---------- routing ---------- */

  function leaveRecipe() {
    state.timers = {};
    if (tickId) { clearInterval(tickId); tickId = null; }
    maybeStopAlarm();
    if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
    state.wakeWanted = false;
    state.current = null;
  }

  function route() {
    leaveRecipe();
    const m = location.hash.match(/^#\/r\/(.+)$/);
    if (m) {
      let slug = m[1];
      try { slug = decodeURIComponent(slug); } catch (e) { /* keep raw */ }
      showRecipe(slug);
    } else {
      showHome();
    }
    window.scrollTo(0, 0);
  }

  /* ---------- events ---------- */

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
      default: break;
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.action === 'ing') {
      if (el.checked) state.checked.add(el.dataset.key);
      else state.checked.delete(el.dataset.key);
    } else if (el.dataset.action === 'wake') {
      setWake(el.checked);
    }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'search') {
      state.query = e.target.value;
      drawList();
    }
  });

  window.addEventListener('hashchange', route);

  loadRecipes().then(route);
})();
