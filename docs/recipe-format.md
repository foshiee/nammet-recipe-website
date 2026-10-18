# Recipe file format

Each recipe on the site is one JSON file in the `recipes/` folder. The site lists that folder, reads every `.json` file in it, and builds the home page, the search, and each recipe page from what it finds. A complete example that uses every option is in `example-recipe.json`.

## File location and naming

Recipe files go in `/var/www/nomnoms/recipes/` on the web server. A new file shows up after a page refresh; nginx does not need a reload.

You can also sign in (link at the bottom of the home page) and use the **Import recipe** button. It converts a recipe file, web page, PDF, photo or pasted text into this format, lets you check and edit the result, and saves it in this folder. Signed in, **Edit recipe** on a recipe's page changes it later, in a form or as JSON. Setup is described in [install.md](install.md).

The file name, without `.json`, becomes the recipe's web address. `garlic-tomato-spaghetti.json` is served at `https://your-site/#/r/garlic-tomato-spaghetti`. Use lowercase letters, numbers and hyphens, and avoid spaces. Renaming a file changes its address, so any bookmark to the old name stops working.

Two file names are special. `index.json` is never loaded as a recipe, because the site keeps it for the fallback file list described at the end of this document. Anything that does not end in `.json` is ignored.

Save files as UTF-8 so characters like `°`, `é` and `½` display correctly.

## Smallest valid recipe

Only the ingredients and steps are needed to get a usable page:

```json
{
  "title": "Buttered Toast",
  "servings": 2,
  "ingredients": [
    { "amount": 4, "name": "slices of bread" },
    { "amount": 2, "unit": "tbsp", "name": "butter" }
  ],
  "steps": [
    "Toast the bread.",
    "Spread with butter while hot."
  ]
}
```

## Top-level fields

| Field | Type | Required | Behaviour |
|---|---|---|---|
| `title` | string | No | Recipe name. If missing, the file name is used instead. |
| `description` | string | No | One-line summary, shown under the title and on the home page. |
| `servings` | number | No | The number of servings the amounts are written for. This is the starting value of the servings stepper. Defaults to 4 when missing. Use a whole number. |
| `time` | string | No | Free text such as `"1 hr 45 min"`. Shown on the home page as written, and on the recipe page with "total" added after it. |
| `tags` | list of strings | No | Become filter buttons on the home page and are included in search. Converted to lowercase. |
| `source` | string | No | Where the recipe came from. A value starting with `http://` or `https://` becomes a link; anything else is shown as plain text. |
| `image` | string | No | A photo of the finished dish, shown at the top of the recipe page. It names a file in the site's `photos/` folder, such as `"photos/garlic-tomato-spaghetti.jpg"`. See "Photos". |
| `ingredients` | list | No | The ingredient list. See the next section. |
| `steps` | list | No | The method. See "Steps and timers". |
| `notes` | list of strings | No | Tips shown as bullet points at the bottom of the page. A single string also works. |

Fields the site does not know about, such as `author` or `cuisine`, are ignored, so they are safe to add for your own records.

## Ingredients

The `ingredients` list can hold three kinds of entry, mixed in any order.

**A group** is an object with a `group` heading and a list of `items`. Groups produce headings like "For the sauce".

```json
{ "group": "For the sauce", "items": [ { "amount": 2, "unit": "tbsp", "name": "flour" } ] }
```

**An ingredient object** placed directly in the list, outside any group.

**A plain string**, which becomes an ingredient with a name and no amount, for things like `"water for boiling"`.

Entries that sit outside a group are collected into a section without a heading. If they appear after a group, they form a second headingless section. Inside a group's `items`, both objects and plain strings are accepted.

### Ingredient fields

| Field | Type | Behaviour |
|---|---|---|
| `amount` | number or string | The quantity for the recipe's written `servings`. Write `1.5`, or a string such as `"1/2"` or `"1 1/2"`. Omit it or use `null` when there is no quantity. |
| `unit` | string | The unit of measure. See the next section. |
| `name` | string | The ingredient. |
| `note` | string | Extra detail, shown in grey after the name and separated by a comma. Plain text; it is never scaled or converted. |

Do not type Unicode fraction characters such as `½` into `amount`. The site cannot read them, and the quantity will disappear. Use `0.5` or `"1/2"`.

When `amount` is missing or `null`, the `unit` text takes its place in the amount column. That is how `"to taste"` works:

```json
{ "amount": null, "unit": "to taste", "name": "salt" }
```

### Units and conversion

The site recognises these units, ignoring capital letters and trailing periods:

| Unit | Also accepted |
|---|---|
| `tsp` | teaspoon, teaspoons, tsps |
| `tbsp` | tablespoon, tablespoons, tbsps, tbs |
| `cup` | cups |
| `fl oz` | floz, fl_oz, fluid ounce, fluid ounces |
| `oz` | ounce, ounces, ozs |
| `lb` | pound, pounds, lbs |
| `g` | gram, grams, gms |
| `kg` | kilogram, kilograms, kgs |
| `ml` | milliliter, milliliters, millilitre, millilitres, mls |
| `l` | liter, liters, litre, litres |

Any other unit (`clove`, `handful`, `can`, `pinch`) is shown exactly as you typed it and is scaled with the servings, but never converted. It is not made plural either, so write it the way you want it displayed. Leave `unit` out for countable items such as eggs.

The US/Metric toggle changes recognised units as follows:

| Written as | US mode shows | Metric mode shows |
|---|---|---|
| `tsp`, `tbsp` | unchanged | unchanged, because metric spoons are the same sizes |
| `cup`, `fl oz` | unchanged | millilitres, or litres from 1000 ml up |
| `oz`, `lb` | unchanged | grams, or kilograms from 1000 g up |
| `ml`, `l` | cups, tablespoons or teaspoons, depending on the size | unchanged |
| `g`, `kg` | ounces, or pounds from 16 oz up | unchanged |

Converted values are rounded to numbers a cook would use. In metric, results under 20 round to the nearest 1, under 200 to the nearest 5, and larger values to the nearest 10, so 1 cup becomes 240 ml and 1 lb becomes 450 g. In US units, amounts are rounded to the nearest eighth and printed as fractions such as `1 ¾`. A metric amount you wrote yourself and that needs no conversion is not rounded this way; it only loses decimals above 10.

### Scaling

Every `amount` is multiplied by the selected servings divided by the recipe's `servings`. A recipe written for 4 and shown for 6 multiplies each amount by 1.5. Step text, notes and ingredient notes are plain text and do not change, so keep quantities out of them. Write "add the garlic", not "add the 4 cloves".

## Steps and timers

Each entry in `steps` is either a plain string or an object:

| Field | Type | Behaviour |
|---|---|---|
| `title` | string | Optional short heading above the step text. |
| `text` | string | The instruction. |
| `timer` | number | Optional duration in seconds. Adds a button such as "Start 15 min timer" to the step. |

Steps are numbered automatically. Tapping a step's number marks it done, which greys the step out and strikes through its text. Ticks on steps and ingredients are not saved, so they reset when the page reloads.

A timer counts down on the button and can be stopped with a tap. At zero, the device plays three beeps every 4 seconds and vibrates, if it supports vibration, until the button is tapped. Browsers only allow sound after the person has interacted with the page, so the beep works because the timer is started with a tap. Leaving the recipe cancels its timers.

Common durations: 60 is 1 minute, 600 is 10 minutes, 900 is 15 minutes, 3600 is 1 hour.

## Photos

The easiest way to add a photo is on the site. Sign in, open the recipe and use **Add photo**, or choose one on the import screen before saving. A chosen photo opens in an editor with a frame the shape of the recipe page's photo (3:2): drag it to reposition, and zoom with the slider, mouse wheel, a pinch or the + and − keys to crop it. Importing from a web page offers the page's own photo uncropped, with **Adjust photo** to crop it the same way. Photos added this way are scaled down to 1600 pixels on the long side and saved as JPEG without the camera's details (such as where the photo was taken), as `photos/<file name>-<code>.jpg`. The site fills in `image` for you. Replacing or removing the photo deletes the old file.

To add one by hand, copy the file into `/var/www/nomnoms/photos/` on the server and set `image` to `"photos/"` followed by its name. The name may use letters, numbers, dots, hyphens and underscores, must start with a letter or number, and must end in `.jpg`, `.jpeg`, `.png` or `.webp`. Make large photos smaller first: 1600 pixels across is plenty. Browsers may keep showing the old version of a file for up to a day, so give a changed photo a new name. The site never deletes photos added by hand.

Only files in the site's own `photos/` folder work. Addresses on other websites are ignored, and the import screen leaves them out with a warning, so visitors' browsers never contact other sites. If the file is missing, the recipe shows without a photo.

The home page can show a small copy of each photo beside the recipe's name. An admin turns this on with **Show photos on the home page** on the admin page.

## What the home page uses

The home page lists recipes alphabetically by `title`. Each row shows the title, `description`, `servings` and `time`, and the `image` when photos on the home page are turned on. Search matches against the title, description, tags and every ingredient name, and a search with several words requires all of them to match. Tag buttons narrow the list to recipes carrying that tag.

## JSON syntax rules

The site reads strict JSON, which is less forgiving than most formats.

- Use double quotes around every key and every text value. Single quotes are not valid.
- Separate list items and fields with commas, but put no comma after the last one. A trailing comma is the most frequent reason a file fails to load.
- Numbers have no quotes (`4`), and text has quotes (`"4"`). Amounts and servings should be numbers, apart from fractions like `"1/2"`.
- Comments are not allowed.
- Quote characters inside text need a backslash: `"the \"best\" sauce"`.

To check a file before uploading it, run `python3 -m json.tool recipe.json`. It prints the file if the syntax is valid and names the line of the first error if not. When the site cannot read a file, the home page lists its name under "Some recipe files couldn't be read" with the reason.

## How the site finds recipes

The preferred method is the folder listing. nginx returns the contents of `/recipes/` as JSON because the config has `autoindex on; autoindex_format json;` for that location, and the site loads every `.json` file in the list.

If the listing is unavailable, the site falls back to a hand-written `recipes/index.json`: a list of file names that must be updated each time a recipe is added.

```json
["garlic-tomato-spaghetti.json", "buttered-toast.json"]
```

If neither works, the home page shows "Couldn't load the recipe list".
