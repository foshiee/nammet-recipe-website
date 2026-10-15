# CLAUDE.md

Static recipe website: vanilla HTML/CSS/JS served by nginx, with recipes stored as plain JSON files. No build step, no package manager, no tests, no backend.

## Layout

The repo mirrors the target server's filesystem, so paths map 1:1 onto the recipe VM:

| Repo path | Deployed to | Purpose |
|---|---|---|
| `var/www/recipes/index.html` | `/var/www/recipes/` | Shell page: a `<main id="app">` plus `app.js` (deferred). |
| `var/www/recipes/app.js` | same | The entire app (~700 lines, one IIFE). |
| `var/www/recipes/style.css` | same | All styling; light/dark via `prefers-color-scheme` and CSS variables in `:root`. |
| `var/www/recipes/recipes/*.json` | same | Recipe data served to the browser. Only `example-recipe.json` is tracked. |
| `etc/nginx/conf.d/nginx-recipes.conf` | `/etc/nginx/conf.d/recipes.conf` | Server block (note the rename on deploy). |
| `etc/nginx/nginx.conf` | `/etc/nginx/nginx.conf` | Stock RHEL-style main config; includes `conf.d/*.conf`. |
| `docs/recipe-format.md` | n/a | Authoritative recipe JSON spec. |
| `docs/example-recipe.json` | n/a | Example using every field. Duplicate of the copy under `var/www/recipes/recipes/`; keep both in sync. |
| `recipes/` (repo root) | n/a | **Gitignored** (`/recipes` in `.gitignore`). Local working collection of ~39 real recipes. Not committed and not the served folder. |

## Running and testing

There is nothing to build. To try it locally, serve `var/www/recipes/` with something that emulates the nginx JSON directory listing, or use the `recipes/index.json` fallback (see below). A plain `python -m http.server` does not return a JSON listing for `recipes/`, so the app will report "Couldn't load the recipe list" unless an `index.json` exists. Validate a recipe file with `python3 -m json.tool file.json`.

## How the app works (`app.js`)

- **Recipe discovery:** `loadRecipes()` fetches `recipes/` expecting nginx's `autoindex_format json` output (array of `{name, type}`), keeping `type === 'file'` entries. If that fails it falls back to `recipes/index.json` (array of file names). `index.json` is never treated as a recipe. Each file is fetched with `cache: 'no-cache'`; unreadable files are collected in `state.problems` and shown on the home page rather than failing the whole load.
- **Normalisation:** `normalizeRecipe()` turns raw JSON into a uniform shape. The slug is the file name minus `.json`. Title falls back to the slug, servings to 4, tags are lowercased, `notes` may be a string or list, steps may be strings or `{title,text,timer}`. `normalizeGroups()` flattens ingredients into groups (explicit `{group, items}` or loose entries gathered into headingless groups). A lowercase `search` string is precomputed per recipe (title, description, tags, ingredient names).
- **Routing:** hash-based. `#/r/<slug>` shows a recipe; anything else shows home. `route()` runs on `hashchange` and after the initial load, and always calls `leaveRecipe()` first to clear timers, alarm and wake lock.
- **Rendering:** no framework. Views are built with template strings assigned to `innerHTML`; all user data goes through `esc()`. Event handling is delegated on `#app` using `data-action` attributes (`click`, `change`, `input` listeners at the bottom). New interactive elements should follow this pattern rather than attaching their own listeners.
- **State:** a single `state` object. Only the US/Metric choice persists (localStorage key `recipes:units`, via `getPref`/`setPref`, wrapped in try/catch). Servings, ticked ingredients and ticked steps reset on navigation or reload by design.
- **Scaling and units:** ingredient amount x (selected servings / written servings). `ALIASES`, `VOL` (ml) and `WT` (g) drive recognition and conversion in `convert()`. Metric output is rounded with `niceRound()` only when converted; US output is formatted to eighths with Unicode fractions by `fmtFraction()`. Unknown units pass through untouched and are not pluralised. `parseAmount()` accepts numbers or `"1/2"` / `"1 1/2"` strings, but not Unicode fraction characters.
- **Timers:** per-step `timer` (seconds). A 250ms `setInterval` tick updates countdowns; at zero the alarm beeps via Web Audio every 4s (plus vibrate) until dismissed. The AudioContext is created in `ensureAudio()` on the start tap, since browsers require a user gesture.
- **Wake lock:** optional "Keep screen on" checkbox using the Screen Wake Lock API, re-acquired on `visibilitychange`.

## nginx

`nginx-recipes.conf` is a `default_server` on port 80 with root `/var/www/recipes`. `/` uses `try_files` with `Cache-Control: no-cache`. `/recipes/` enables `autoindex on; autoindex_format json;`, which is what lets new recipe files appear on a page refresh without editing code or reloading nginx. Removing that block breaks recipe discovery (only the `index.json` fallback remains).

## Conventions

- Keep it dependency-free: no bundler, framework or npm packages.
- Recipe format changes must be made in three places together: `normalizeRecipe`/related code in `app.js`, `docs/recipe-format.md`, and the example recipe (both copies).
- Recipe files: kebab-case names (`garlic-tomato-spaghetti.json`), UTF-8, strict JSON (no comments, no trailing commas). The file name is the public URL, so renaming breaks bookmarks.
- Keep quantities out of step and note text; those strings are never scaled.
- Colours live in CSS variables at the top of `style.css`, with a dark-mode override block.
