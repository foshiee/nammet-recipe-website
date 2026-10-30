# Using the import service

This page covers what the optional import service adds once it's running: signing in, importing and editing recipes, the admin page, roles and passwords. To set the service up, see [install.md](install.md) or [docker.md](docker.md).

The static site works without any of this. If the service is down, browsing and cooking are unaffected, and the site keeps its saved look; only the import and admin pages show an error.

## Signing in and what you can do

Visitors see no sign of the import feature apart from a small **Sign in** link at the bottom of the home page, which opens `#/import` (you can bookmark it too). Once you're signed in, buttons appear at the top right of the home page and stay for the session (7 days by default):

- **Add recipe** (importers and admins): import a recipe from a file, a web address or pasted text, or write one in a form, check the preview, edit it if needed, add a photo of the finished dish, and save it straight into the recipes folder. It appears on the site immediately. A web page's own recipe photo is offered automatically.
- **Edit recipe** (importers and admins), under the title of any recipe: change it in a form, or as the raw JSON file for those who prefer it (the browser remembers which). If someone else saves the recipe while you're editing, saving stops and asks whether to load their version or save yours over it. The file name, which is the recipe's address, can't be changed here. Admins also get **Delete recipe** on the same page, which removes the recipe and its photo after a confirmation, and can't be undone.
- **Add photo / Change photo / Remove photo** (importers and admins), under the title of any recipe.
- **Admin** (admins only), also at `#/admin`: change the site name and icon, pick a colour theme (each has light and dark colours) and fine-tune its colours, choose the fonts and corner rounding, and show photos on the home page; add, test or remove the Anthropic API key and pick the model and effort; and add users, change their roles, reset passwords and remove them.

## Roles

There are two roles. **Admins** can do everything. **Importers** can only import and edit recipes and change their photos. Visitors don't need an account. The server checks the role on every request, so hidden buttons are not the only protection. The site always keeps at least one admin: the last one can't be removed or demoted.

## Demo mode

A server started with `DEMO_MODE=true` is a public demo with a shared admin login, so nothing a visitor writes is kept. Importing and editing work up to the preview, and the admin page's colours, fonts and corners can be saved. Saving recipes and photos, the site name and icon, users, passwords, the API key, the model and effort, and deleting recipes are turned off, and their buttons show as disabled. See [docker.md](docker.md#running-a-public-demo) for setting one up.

## Passwords

A password set for someone else, whether on the admin page or with the command-line tool, is temporary. At their first sign-in they're asked to choose their own, and they can't do anything else until they have. Anyone signed in can also change their password at any time with **Change password** next to **Sign out**.

There's no "forgot password" link: that would need some other way to prove who you are, such as email, so a forgotten password is reset by an admin, who hands over a new temporary one.

## How imports are converted

| Input | Method | Uses Claude? |
|---|---|---|
| Recipe `.json` in this site's format | Validated as is | No |
| Web address or saved `.html` page with schema.org recipe data (most recipe sites) | Read from the page's recipe data | No |
| Web page without recipe data, plain text, pasted text | Page text sent to Claude | Yes |
| PDF, photo or screenshot (JPEG, PNG, WebP, GIF) | File sent to Claude | Yes |

Every import is checked against [recipe-format.md](recipe-format.md) and shown for review before saving. Claude's results are labelled so you know to check them against the original.

Not supported: HEIC photos (export as JPEG or take a screenshot), Word and other Office files (save as PDF), and pages behind a login or paywall.

Claude imports cost a few cents each; see [Cost of Claude imports](install.md#cost-of-claude-imports).
