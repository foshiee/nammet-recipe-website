# Recipe import: setup and operation

Visitors see no sign of the import feature apart from a small **Sign in** link at the bottom of the home page, which opens `#/import` (you can bookmark it too). Once you're signed in, an **Import recipe** button appears at the top right of the home page and stays for the session (7 days by default). From there you can import a recipe from a file, a web address or pasted text, check and edit it, and save it straight into the recipes folder. It appears on the site immediately.

The static site still works without any of this. If the import service is down, browsing and cooking are unaffected; only the import page shows an error.

## How it works

```
browser ──HTTPS──> Traefik ──HTTP──> nginx :80 ──> /var/www/recipes        (static site, as before)
                                          └─ /api/ ──> nomnoms-api :3000   (Node, 127.0.0.1 only)
                                                          ├─ reads  /var/lib/nomnoms/users.json
                                                          ├─ writes /var/www/recipes/recipes/<name>.json
                                                          └─ calls  api.anthropic.com (only when needed)
```

How each input is converted:

| Input | Method | Uses Claude? |
|---|---|---|
| Recipe `.json` in this site's format | Validated as is | No |
| Web address or saved `.html` page with schema.org recipe data (most recipe sites) | Read from the page's recipe data | No |
| Web page without recipe data, plain text, pasted text | Page text sent to Claude | Yes |
| PDF, photo or screenshot (JPEG, PNG, WebP, GIF) | File sent to Claude | Yes |

Every import is checked against [recipe-format.md](recipe-format.md) and shown for review before saving. Claude's results are labelled so you know to check them against the original.

Not supported: HEIC photos (export as JPEG or take a screenshot), Word and other Office files (save as PDF), and pages behind a login or paywall.

## Requirements

- Node.js 20 or newer on the VM, with npm (`node --version`). On RHEL-family systems: `sudo dnf module install nodejs:22`, or the NodeSource packages.
- The `acl` package, for `setfacl` (usually installed already: `rpm -q acl`).
- Outbound internet access from the VM on ports 443 and 80: to `api.anthropic.com` for Claude imports, to any recipe site you import from, and to `registry.npmjs.org` while installing. The service connects directly; it doesn't support an outbound HTTP proxy. To check, run this on the VM. Each line should print an HTTP status code; a timeout or `000` means outbound access is blocked:

  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://api.anthropic.com/
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://www.bbcgoodfood.com/
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://registry.npmjs.org/
  ```

  Any number counts as success, including `404`; it only proves the VM can reach the site.
- An Anthropic API key for PDF, photo and text imports, from [console.anthropic.com](https://console.anthropic.com). Without one, `.json` files and most recipe websites still import.

## First-time setup on the VM

### 1. Package the files (on your PC)

The repo mirrors the server's layout, so one archive carries everything. In PowerShell from the repo root (Windows 10 and 11 include `tar` and `scp`):

```powershell
tar -czf nomnoms-deploy.tgz --exclude=node_modules --exclude=dev-users.json `
  opt/nomnoms-api etc/nomnoms etc/systemd etc/nginx/conf.d/nginx-recipes.conf `
  var/www/recipes/index.html var/www/recipes/app.js var/www/recipes/style.css
scp nomnoms-deploy.tgz you@your-vm:~/
```

### 2. Unpack and fix line endings (on the VM)

Run everything from here on as a user with sudo.

```sh
rm -rf /tmp/nomnoms-deploy && mkdir /tmp/nomnoms-deploy
tar -xzf ~/nomnoms-deploy.tgz -C /tmp/nomnoms-deploy
cd /tmp/nomnoms-deploy
# Git on Windows may have turned line endings into CRLF. A stray \r breaks the
# systemd unit and gets glued onto the API key, so strip them from everything.
find . -type f \( -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.css' \
  -o -name '*.conf' -o -name '*.service' -o -name '*.example' \) -exec sed -i 's/\r$//' {} +
```

### 3. Update the website

This adds the Import recipe button and the sign-in and import screens. Your recipes folder is untouched.

```sh
sudo install -m 0644 var/www/recipes/index.html var/www/recipes/app.js var/www/recipes/style.css /var/www/recipes/
sudo restorecon -v /var/www/recipes/*.html /var/www/recipes/*.js /var/www/recipes/*.css   # SELinux labels
```

### 4. Create the service account and its data folder

```sh
sudo useradd --system --home-dir /var/lib/nomnoms --shell /sbin/nologin nomnoms
sudo install -d -m 0700 -o nomnoms -g nomnoms /var/lib/nomnoms
```

### 5. Install the service code

```sh
sudo mkdir -p /opt/nomnoms-api
sudo cp -r opt/nomnoms-api/. /opt/nomnoms-api/
cd /opt/nomnoms-api && sudo npm ci --omit=dev && cd -
```

`npm ci` installs the two dependencies (`@anthropic-ai/sdk` and `busboy`) at the exact versions in `package-lock.json`.

### 6. Let the service write recipes

This adds write access for `nomnoms` without changing who owns the folder, so you can still copy files in by hand:

```sh
sudo setfacl -m u:nomnoms:rwx /var/www/recipes/recipes
```

### 7. Configuration

```sh
sudo install -d -m 0750 -o root -g nomnoms /etc/nomnoms
sudo install -m 0640 -o root -g nomnoms etc/nomnoms/api.env.example /etc/nomnoms/api.env
sudo nano /etc/nomnoms/api.env     # paste your key after ANTHROPIC_API_KEY=
```

No quotes or spaces around the key. If you leave it empty for now, everything except PDF, photo and text imports still works. Add it later and restart the service.

### 8. Create your login

Passwords need at least 12 characters. Run it from `/opt/nomnoms-api`, because the `nomnoms` account can't read your home directory.

```sh
cd /opt/nomnoms-api
sudo -u nomnoms USERS_FILE=/var/lib/nomnoms/users.json node tools/add-user.js yourname
cd -
```

### 9. Start the service

```sh
sudo install -m 0644 etc/systemd/system/nomnoms-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nomnoms-api
systemctl status nomnoms-api --no-pager      # should say "active (running)"
curl -s http://127.0.0.1:3000/api/me         # {"user":null}
```

The service listens only on `127.0.0.1`, so no firewall port needs opening for it.

### 10. SELinux

nginx needs permission to connect to the service:

```sh
sudo setsebool -P httpd_can_network_connect 1
```

### 11. nginx

```sh
sudo cp /etc/nginx/conf.d/recipes.conf /etc/nginx/conf.d/recipes.conf.bak
sudo install -m 0644 etc/nginx/conf.d/nginx-recipes.conf /etc/nginx/conf.d/recipes.conf
sudo nano /etc/nginx/conf.d/recipes.conf     # set Traefik's address, uncomment the three real-IP lines
sudo nginx -t && sudo systemctl reload nginx
```

The address to use, and how to find it, is in the security checklist below.

### 12. Check it end to end

1. Open the site in a browser over HTTPS. There should be a small **Sign in** link at the bottom of the home page. If it isn't there, force-refresh the page (Ctrl+F5) to drop the cached `app.js`.
2. Click it and sign in. You should land on the import screen, and the home page should now show **Import recipe** at the top right.
3. Import a recipe web page, such as one from BBC Good Food or Allrecipes. The review screen should say *Read from the recipe data the web page publishes*.
4. Save it. You should land on the new recipe, and it should be on the home page.
5. If you set an API key, import a photo or PDF of a recipe as well. That checks the Claude path.
6. Watch it all in the log: `journalctl -u nomnoms-api -f`.

If the import page says *The import service isn't available on this server*, nginx can't reach the service. Check `systemctl status nomnoms-api`, the SELinux boolean from step 10, and `sudo tail /var/log/nginx/error.log`.

When it all works, delete the staging files: `rm -rf /tmp/nomnoms-deploy ~/nomnoms-deploy.tgz`.

## Security checklist (Traefik in front)

Traefik ends HTTPS, so passwords and session cookies are encrypted between the browser and your network. Check the following:

- **nginx port 80 is reachable only from Traefik.** Otherwise someone on the network could sign in over plain HTTP. Which address Traefik's requests come from depends on where it runs:
  - **Traefik on another machine:** that machine's IP.
  - **Traefik in Docker on this VM:** the Docker network's gateway, often `172.17.0.1` or `172.18.0.1`. Check with `docker network inspect <network>`. Use the subnet, such as `172.18.0.0/16`.
  - **Traefik installed directly on this VM:** `127.0.0.1`. Nothing outside the VM needs port 80, so close it completely.

  To confirm, watch `sudo tail -f /var/log/nginx/access.log` while loading the site. The first column is the address Traefik connects from. Use the same address in nginx's `set_real_ip_from` line. Then, with firewalld:

  ```sh
  sudo firewall-cmd --permanent --remove-service=http
  sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="TRAEFIK_IP/32" port port="80" protocol="tcp" accept'
  sudo firewall-cmd --reload
  ```

  Skip the rich rule if Traefik is on the same VM. Docker publishes container ports around firewalld, but nginx's port 80 isn't a container port, so these rules do apply to it.

- **Traefik redirects HTTP to HTTPS** for this site's router.
- **The Traefik to nginx hop stays on a trusted network**, such as the same host, a Docker network or your LAN.
- **The real-IP lines in the nginx config are filled in.** Without them, the login rate limit counts all visitors as one, so failed logins from anyone lock everyone out for 15 minutes.
- **`COOKIE_SECURE=true`** in `/etc/nomnoms/api.env`, which is the default.

What the service does to protect itself:

- Passwords are hashed with scrypt.
- Sign-in is limited to 5 failures per user name and 10 per IP address in 15 minutes.
- Sessions use random tokens in `HttpOnly; Secure; SameSite=Strict` cookies, and every POST must carry a custom header, which blocks cross-site requests.
- Web-address imports refuse private, loopback and cloud-metadata addresses, including through redirects.
- Uploads are limited to 20 MB, and file types are identified from their contents, not their names.
- Recipe files are written atomically and never overwrite an existing recipe unless you confirm.
- systemd limits the service to writing in the recipes folder.

## Day to day

- **Add or reset a user:** `sudo -u nomnoms USERS_FILE=/var/lib/nomnoms/users.json node /opt/nomnoms-api/tools/add-user.js <name>`
- **Remove a user:** the same command with `--remove`. Their open session lasts until it expires or the service restarts (`sudo systemctl restart nomnoms-api`).
- **List users:** `--list` instead of a name.
- **Logs:** `journalctl -u nomnoms-api -f`. Each import logs who imported what and which method was used. Claude imports also log token usage.
- **Restarting** signs everyone out, because sessions are kept in memory.
- **Updating:** package and unpack as in setup steps 1 and 2, then repeat step 3 for website changes. For service changes, run `sudo cp -r opt/nomnoms-api/. /opt/nomnoms-api/`, then `cd /opt/nomnoms-api && sudo npm ci --omit=dev`, then `sudo systemctl restart nomnoms-api`. Your users file and `api.env` are never part of the package, so updates don't touch them.

## Cost of Claude imports

Imports use `claude-sonnet-5-5` at medium effort by default. That model costs $2 per million input tokens and $10 per million output tokens. Most of the cost is the output, meaning the recipe itself plus the model's reasoning. Expect roughly 2 to 5 US cents per recipe, and more for a long multi-page PDF. These are estimates, so check real figures in the Anthropic console after your first few imports.

To change the model, set `MODEL` in `/etc/nomnoms/api.env` and restart the service (`sudo systemctl restart nomnoms-api`). If blurry photos or messy scanned PDFs come out wrong, `claude-opus-5-5` is more accurate at about twice the price.

## Trying it locally

On your own machine, no nginx is needed. The service can serve the site too, and it emulates nginx's JSON folder listing:

```sh
cd opt/nomnoms-api
npm install
USERS_FILE=./dev-users.json node tools/add-user.js tester
USERS_FILE=./dev-users.json RECIPES_DIR=../../var/www/recipes/recipes \
  DEV_STATIC_ROOT=../../var/www/recipes COOKIE_SECURE=false node server.js
```

Then open http://127.0.0.1:3000. On Windows PowerShell, set the variables with `$env:USERS_FILE = "./dev-users.json"` and so on. Recipes saved this way land in the repo's `var/www/recipes/recipes/` folder, so delete any test recipes before committing. `dev-users.json` is gitignored.

Tests for the parts that don't need Claude: `npm test`.
