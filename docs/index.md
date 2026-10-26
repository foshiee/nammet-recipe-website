# Nomnoms Recipe Website

A self-hosted recipe website for one household or a small group. Recipes are plain JSON files in a folder, the front end is a single HTML page with vanilla JavaScript and CSS, and nginx serves the lot. There is no database, no build step and no front-end dependencies.

An optional Node service adds sign-in, recipe import (from a file, a web page or pasted text), adding recipes in a form, and an admin page. Without it, the site still browses and cooks.

![A recipe page: a photo of the dish, the title and description, and a bar with servings and US/metric controls](screenshots/recipe-desktop.webp)

## Where to start

- **[Install](install.md)**: set up a server from a fresh Rocky Linux 10 VM, with `install.sh` or by hand, and run the import service.
- **[Docker](docker.md)**: run the published image, with volumes, settings and updating.
- **[Using the service](using-the-service.md)**: signing in, roles, passwords and importing recipes.
- **[Recipe format](recipe-format.md)**: the JSON spec for a recipe file.

## Features

**For cooking**

- Search across titles, descriptions, tags and ingredients.
- Scale any recipe to a different number of servings.
- Switch between US and metric units.
- Tick off ingredients and steps as you go.
- Step timers with an alarm that keeps beeping until you dismiss it.
- A "Keep screen on" option so your phone doesn't lock with flour on your hands.
- Light and dark mode.

**With the import service**

- Import from a recipe web page, PDF, cookbook photo or plain text.
- Write or edit recipes in a form, with a live preview and photos.
- An admin page for users, the site's look and the Claude model and API key.

![The home page with pasta typed into the search box and the list filtered to pasta recipes](screenshots/search-desktop.webp)

## How it fits together

![A browser connects over HTTPS to a reverse proxy (Traefik), which forwards to nginx on port 80. nginx serves the static site from /var/www/nomnoms and proxies /api/ to the Node import service on 127.0.0.1:3000.](diagrams/overview.svg)

nginx lists the `recipes/` folder as JSON, and the app fetches that listing to find recipes. Dropping a new `.json` file into the folder makes it appear on the next page refresh.

## Source and support

The code is on [GitHub](https://github.com/foshiee/nomnoms-recipe-website) under the MIT License. If the site has earned a place in your kitchen, you can [buy me a pint on Ko-fi](https://ko-fi.com/foshiee).
