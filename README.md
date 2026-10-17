# nomnoms

A self-hosted recipe website for one household or a small group. Recipes are plain JSON files in a folder, the front end is a single HTML page with vanilla JavaScript and CSS, and nginx serves the lot. There is no database, no build step and no front-end dependencies.

An optional Node service adds sign-in, recipe import (from a file, a web page or pasted text) and an admin page. Without it, the site still browses and cooks.

## Features

**For cooking**

- Search across titles, descriptions, tags and ingredients.
- Scale any recipe to a different number of servings.
- Switch between US and metric units. Conversions cover common volume and weight units; anything unrecognised (a "handful", a "pinch") passes through unchanged.
- Tick off ingredients and steps as you go.
- Step timers with an alarm that keeps beeping until you dismiss it.
- A "Keep screen on" option, using the Screen Wake Lock API, so your phone doesn't lock with flour on your hands.
- Light and dark mode follow the system setting.

**With the import service**

- Import from a recipe web page. Pages with schema.org Recipe markup (most recipe sites) are parsed directly with no AI involved, and the page's photo comes along.
- Import from a PDF, a photo of a cookbook page, plain text or a page without markup, using Claude through the Anthropic API. This is the only feature that needs an API key.
- Review every import before saving: a preview, the raw JSON to edit, and validation warnings such as quantities written into step text (which wouldn't scale).
- Add, crop and replace recipe photos. Photos are re-encoded in the browser, which strips EXIF and GPS data, and stripped again on the server.
- An admin page for user accounts (admin and importer roles), the site name and favicon, colour themes with a contrast checker, fonts and corner radius, and the Claude model and API key.

## How it fits together

```
browser ──> Traefik (HTTPS) ──> nginx ──> /var/www/nomnoms      static site and recipe JSON
                                       └─> /api/ ──> Node service on 127.0.0.1:3000
```

nginx lists the `recipes/` folder as JSON (`autoindex_format json`), and the app fetches that listing to find recipes. Dropping a new `.json` file into the folder makes it appear on the next page refresh. If you'd rather not use nginx's listing, a `recipes/index.json` holding an array of file names works too.

The repo mirrors the server's filesystem, so `var/www/nomnoms/` deploys to `/var/www/nomnoms/`, `opt/nomnoms-api/` to `/opt/nomnoms-api/`, and so on.

| Path | What it is |
|---|---|
| `var/www/nomnoms/` | The website: `index.html`, `app.js`, `style.css`, `recipes/`, `photos/` |
| `opt/nomnoms-api/` | The optional Node service (Node 20+, two dependencies) |
| `etc/nginx/` | nginx config, including rate limits and an AI-crawler block |
| `etc/systemd/system/` | systemd unit for the service, sandboxed to the folders it writes |
| `etc/nomnoms/api.env.example` | Service settings template |
| `docs/` | Recipe format spec, server setup guide and an example recipe |

## Quick start

### Just the website

Copy `var/www/nomnoms/` to any web server that can return a JSON directory listing for `recipes/` (the included nginx config does this), or add a `recipes/index.json`:

```json
["example-recipe.json", "garlic-tomato-spaghetti.json"]
```

Then write recipes by hand following [docs/recipe-format.md](docs/recipe-format.md). The smallest valid recipe is a title, ingredients and steps:

```json
{
  "title": "Buttered Toast",
  "ingredients": [
    { "amount": 2, "name": "slices of bread" },
    { "amount": 1, "unit": "tbsp", "name": "butter" }
  ],
  "steps": ["Toast the bread.", "Spread with butter while hot."]
}
```

### Running locally with the service

The service can serve the site itself and emulate nginx's folder listing, so you don't need nginx on your own machine:

```sh
cd opt/nomnoms-api
npm install
USERS_FILE=./dev-users.json node tools/add-user.js tester --role admin --permanent
mkdir -p ../../var/www/nomnoms/theme
USERS_FILE=./dev-users.json SETTINGS_FILE=./dev-settings.json THEME_DIR=../../var/www/nomnoms/theme \
  RECIPES_DIR=../../var/www/nomnoms/recipes PHOTOS_DIR=../../var/www/nomnoms/photos \
  DEV_STATIC_ROOT=../../var/www/nomnoms COOKIE_SECURE=false node server.js
```

`add-user.js` asks for a password. Open http://127.0.0.1:3000 and sign in as `tester` with it. On PowerShell, set each variable with `$env:USERS_FILE = "./dev-users.json"` and so on.

Run the service's tests with `npm test`. They use Node's built-in test runner and need neither network access nor an API key.

### Deploying to a server

[docs/install.md](docs/install.md) walks through a full install on a fresh Rocky Linux 10 VM: packages, the service account, systemd, SELinux, nginx, and a security checklist for running behind Traefik. It also covers what Claude imports cost.

## Recipe format

Each recipe is one UTF-8 JSON file named in kebab-case, such as `garlic-tomato-spaghetti.json`. The file name becomes the recipe's URL (`#/r/garlic-tomato-spaghetti`), so renaming a file breaks bookmarks to it.

Recipes can have a description, servings, a time, tags, a source, a photo, grouped ingredients ("Sauce", "To serve"), step titles, per-step timers and notes. [docs/example-recipe.json](docs/example-recipe.json) uses every field, and [docs/recipe-format.md](docs/recipe-format.md) is the full spec.

Keep quantities in the ingredient list rather than in step text. Ingredient amounts scale and convert; step text is shown as written.

## Security

The import service is built to sit on the public internet behind HTTPS:

- Passwords are hashed with scrypt, and logins are rate-limited per IP and per username.
- Sessions use `SameSite=Strict` cookies, and every POST needs an `X-Requested-With` header as CSRF protection.
- Passwords an admin sets are temporary; the user must change theirs before doing anything else. There is no self-service password reset.
- URL imports refuse private and internal addresses, check every redirect hop, and cap size and time, to prevent server-side request forgery.
- The systemd unit lets the service write only to the recipes, photos and theme folders and its own state directory.
- The Anthropic API key is write-only on the admin page: it is never sent back to the browser, which only sees its last four characters.

nginx returns 403 to known AI crawlers and scraping libraries, and `robots.txt` asks the same crawlers to stay away.

## Support

nomnoms is free, and you can use it however you like. If it's earned a place in your kitchen, you can [buy me a pint🍺 on Ko-fi](https://ko-fi.com/foshiee).

## License

Released under the [MIT License](LICENSE).
