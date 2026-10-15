# CLAUDE.md

Static recipe website: vanilla HTML/CSS/JS served by nginx, with recipes stored as plain JSON files. The front end has no build step and no dependencies. A small optional Node service (`opt/nomnoms-api`) adds login and recipe import. The site browses and cooks without it.

## Layout

The repo mirrors the target server's filesystem, so paths map 1:1 onto the recipe VM:

| Repo path | Deployed to | Purpose |
|---|---|---|
| `var/www/recipes/index.html` | `/var/www/recipes/` | Shell page: a `<main id="app">` plus `app.js` (deferred). |
| `var/www/recipes/app.js` | same | The entire front end (one IIFE), including the sign-in and import screens. |
| `var/www/recipes/style.css` | same | All styling; light/dark via `prefers-color-scheme` and CSS variables in `:root`. |
| `var/www/recipes/recipes/*.json` | same | Recipe data served to the browser. Only `example-recipe.json` is tracked. |
| `opt/nomnoms-api/` | `/opt/nomnoms-api/` | Node service for login and import, proxied at `/api/`. See below. |
| `etc/nginx/conf.d/nginx-recipes.conf` | `/etc/nginx/conf.d/recipes.conf` | Server block (note the rename on deploy). |
| `etc/nginx/nginx.conf` | `/etc/nginx/nginx.conf` | Stock RHEL-style main config; includes `conf.d/*.conf`. |
| `etc/systemd/system/nomnoms-api.service` | same | systemd unit for the service, which can write only to the recipes folder. |
| `etc/nomnoms/api.env.example` | `/etc/nomnoms/api.env` | Service settings, including `ANTHROPIC_API_KEY`. The real file is never committed. |
| `docs/recipe-format.md` | n/a | Authoritative recipe JSON spec. |
| `docs/import-setup.md` | n/a | Deploying and running the import service, plus the security checklist. |
| `docs/example-recipe.json` | n/a | Example using every field. Duplicate of the copy under `var/www/recipes/recipes/`; keep both in sync. |
| `recipes/` (repo root) | n/a | **Gitignored** (`/recipes` in `.gitignore`). Local working collection of ~39 real recipes. Not committed and not the served folder. |

## Running and testing

The front end has nothing to build. The easiest local setup is the API's dev mode, which serves `var/www/recipes/` and emulates nginx's JSON listing (commands in `docs/import-setup.md`, "Trying it locally"). A plain `python -m http.server` doesn't return a JSON listing for `recipes/`, so the app reports "Couldn't load the recipe list" unless an `index.json` exists. Validate a recipe file with `python3 -m json.tool file.json`.

Backend tests: `cd opt/nomnoms-api && npm test` (Node's built-in runner, no network or API key needed).

## How the app works (`app.js`)

- **Recipe discovery:** `loadRecipes()` fetches `recipes/` expecting nginx's `autoindex_format json` output (array of `{name, type}`), keeping `type === 'file'` entries. If that fails it falls back to `recipes/index.json` (array of file names). `index.json` is never treated as a recipe. Each file is fetched with `cache: 'no-cache'`; unreadable files are collected in `state.problems` and shown on the home page rather than failing the whole load.
- **Normalisation:** `normalizeRecipe()` turns raw JSON into a uniform shape. The slug is the file name minus `.json`. Title falls back to the slug, servings to 4, tags are lowercased, `notes` may be a string or list, steps may be strings or `{title,text,timer}`. `normalizeGroups()` flattens ingredients into groups (explicit `{group, items}` or loose entries gathered into headingless groups). A lowercase `search` string is precomputed per recipe (title, description, tags, ingredient names).
- **Routing:** hash-based. `#/r/<slug>` shows a recipe, `#/import` shows sign-in or the import screen, and anything else shows home. `route()` runs on `hashchange` and after the initial load, and always calls `leaveRecipe()` first to clear timers, alarm and wake lock.
- **Rendering:** no framework. Views are built with template strings assigned to `innerHTML`; all user data goes through `esc()`. Event handling is delegated on `#app` using `data-action` attributes (`click`, `change`, `input`, `submit` and drag-and-drop listeners at the bottom; forms carry `data-action` too). New interactive elements should follow this pattern rather than attaching their own listeners.
- **State:** a single `state` object. Only the US/Metric choice persists (localStorage key `recipes:units`, via `getPref`/`setPref`, wrapped in try/catch). Servings, ticked ingredients and ticked steps reset on navigation or reload by design. `state.user` comes from `GET api/me`, loaded separately so it never delays the recipe list. `drawAccount()` then fills the home page's header slot (the Import button, shown only when signed in) and footer slot (a "Sign in" link or "Signed in as … · Sign out"). Visitors see nothing import-related besides that footer link. `state.imp` holds the import draft until it's saved or discarded.
- **Scaling and units:** ingredient amount x (selected servings / written servings). `ALIASES`, `VOL` (ml) and `WT` (g) drive recognition and conversion in `convert()`. Metric output is rounded with `niceRound()` only when converted; US output is formatted to eighths with Unicode fractions by `fmtFraction()`. Unknown units pass through untouched and are not pluralised. `parseAmount()` accepts numbers or `"1/2"` / `"1 1/2"` strings, but not Unicode fraction characters.
- **Timers:** per-step `timer` (seconds). A 250ms `setInterval` tick updates countdowns; at zero the alarm beeps via Web Audio every 4s (plus vibrate) until dismissed. The AudioContext is created in `ensureAudio()` on the start tap, since browsers require a user gesture.
- **Wake lock:** optional "Keep screen on" checkbox using the Screen Wake Lock API, re-acquired on `visibilitychange`.
- **Import UI:** `api()` wraps fetch for `/api/` and always sends `X-Requested-With: nomnoms`. The flow: choose a source (file, URL or pasted text), get a draft back, review it (a preview built with `normalizeRecipe`/`amountText`, an editable JSON textarea and a file-name field), then save. A 409 response offers "replace", and on success the app reloads recipes and opens the new one.

## Import service (`opt/nomnoms-api`)

Node 20+, ES modules, two dependencies (`@anthropic-ai/sdk`, `busboy`). Settings come from environment variables in `config.js`.

- `server.js`: plain `http` server with routes `GET /api/me` and `POST /api/login`, `/api/logout`, `/api/import` and `/api/recipes`. Every POST needs the `X-Requested-With: nomnoms` header (CSRF protection, alongside `SameSite=Strict` cookies). `DEV_STATIC_ROOT` also serves the site for local testing.
- `auth.js`: users file (`USERS_FILE`, re-read on each login), scrypt hashes, in-memory sessions, and per-IP/per-username login rate limiting. Client IP comes from `X-Real-IP`, trusted only from `TRUSTED_PROXIES`. `role` is stored for future multi-user work but not yet enforced. Users are managed with `tools/add-user.js`.
- `import/index.js`: sniffs input by content. Our JSON goes straight through `validate.js`. HTML or JSON with schema.org Recipe data goes through `jsonld.js` + `ingredient.js` (no LLM). PDF, images, plain text and pages without markup go to `llm.js`.
- `import/llm.js`: Claude via the SDK with structured outputs (a JSON schema) and server-side refusal fallbacks. The system prompt restates the format rules, and the schema is mapped back to the site's format. It needs `ANTHROPIC_API_KEY`; without one it returns a clear 503 and the other paths still work.
- `import/fetch-url.js`: SSRF-safe fetch. Only http/https on ports 80/443; every hop, including redirects, must resolve to public IPs, and the connection uses the checked address. Size and time are capped.
- `import/validate.js`: server-side mirror of `docs/recipe-format.md`. Errors block saving; warnings, such as quantities in step text, are shown for review.
- `save.js`: slug rules (`[a-z0-9-]`, not `index`) and an atomic write via a hidden `.tmp` file. It never overwrites unless asked.

## nginx

`nginx-recipes.conf` is a `default_server` on port 80 with root `/var/www/recipes`. `/` uses `try_files` with `Cache-Control: no-cache`. `/recipes/` enables `autoindex on; autoindex_format json;`, which is what lets new recipe files (including imported ones) appear on a page refresh without editing code or reloading nginx. Removing that block breaks recipe discovery (only the `index.json` fallback remains). `/api/` proxies to the service on `127.0.0.1:3000`. HTTPS ends at a Traefik reverse proxy in front of nginx; the commented `set_real_ip_from` lines must name Traefik's address so rate limiting sees real client IPs.

## Conventions

- Front end: keep it dependency-free, with no bundler, framework or npm packages. The backend keeps its dependencies minimal and installs them with `npm ci`.
- Recipe format changes must be made in four places together: `normalizeRecipe`/related code in `app.js`, `opt/nomnoms-api/import/validate.js` (plus the LLM schema and prompt in `llm.js` if the change affects extraction), `docs/recipe-format.md`, and the example recipe (both copies).
- Recipe files: kebab-case names (`garlic-tomato-spaghetti.json`), UTF-8, strict JSON (no comments, no trailing commas). The file name is the public URL, so renaming breaks bookmarks.
- Keep quantities out of step and note text; those strings are never scaled.
- Colours live in CSS variables at the top of `style.css`, with a dark-mode override block.
- Unit aliases exist in both `app.js` (`ALIASES`) and `opt/nomnoms-api/import/ingredient.js` (`UNITS`). Keep them in sync.
