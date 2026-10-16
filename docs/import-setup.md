# Server setup and recipe import

Visitors see no sign of the import feature apart from a small **Sign in** link at the bottom of the home page, which opens `#/import` (you can bookmark it too). Once you're signed in, an **Import recipe** button appears at the top right of the home page and stays for the session (7 days by default). From there you can import a recipe from a file, a web address or pasted text, check and edit it, and save it straight into the recipes folder. It appears on the site immediately.

The static site still works without any of this. If the import service is down, browsing and cooking are unaffected; only the import page shows an error.

## How it works

```
browser ──HTTPS──> Traefik ──HTTP──> nginx :80 ──> /var/www/nomnoms        (static site)
                                          └─ /api/ ──> nomnoms-api :3000   (Node, 127.0.0.1 only)
                                                          ├─ reads  /var/lib/nomnoms/users.json
                                                          ├─ writes /var/www/nomnoms/recipes/<name>.json
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

- A VM for Rocky Linux 10. 1 vCPU, 2 GB of RAM and a 20 GB disk are plenty.
- A Traefik router that ends HTTPS for the site's host name and forwards to port 80 on the VM. Setting up Traefik isn't covered here; the [security checklist](#security-checklist-traefik-in-front) lists what nginx needs to know about it.
- Outbound internet access from the VM: ports 80 and 443 for package installs, `api.anthropic.com`, `registry.npmjs.org` and any recipe site you import from, plus port 22 to `github.com` for fetching the code. The service connects directly; it doesn't support an outbound HTTP proxy.
- An Anthropic API key for PDF, photo and text imports, from [console.anthropic.com](https://console.anthropic.com). Without one, `.json` files and most recipe websites still import.

## Preparing the VM

### 1. Install Rocky Linux 10

Boot the VM from the Rocky Linux 10 minimal ISO. In the installer:

- **Software Selection:** Minimal Install.
- **Network & Host Name:** switch the network adapter on and set a host name. Give the VM a fixed address, either static or a DHCP reservation, so Traefik can always find it.
- **Root Account:** leave it locked.
- **User Creation:** create your own account and make it an administrator (wheel group), so it can use `sudo`.

Leave SELinux enforcing, which is the default. The steps below set the labels and permissions it needs.

When the install finishes, sign in over SSH as your user (`ssh you@your-vm`) and run everything from there.

### 2. Update and install packages

```sh
sudo dnf -y update
sudo dnf -y install nginx nodejs npm git acl nano firewalld policycoreutils
sudo systemctl enable --now firewalld
sudo reboot
```

The reboot picks up any new kernel. After signing back in, check Node.js:

```sh
node --version     # v20 or newer
```

Rocky Linux 10 ships Node.js 22 in its AppStream repository, so no extra repository is needed.

### 3. Check outbound access

Each line should print an HTTP status code. A timeout or `000` means outbound access is blocked:

```sh
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://api.anthropic.com/
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://www.bbcgoodfood.com/
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://registry.npmjs.org/
```

Any number counts as success, including `404`; it only proves the VM can reach the site. GitHub access over SSH is checked in step 4.

## Installing the site and import service

The VM keeps its own clone of the repo and installs from it. The repo mirrors the server's layout, so each file is copied from its repo path to the same path on the server. Run everything as your normal user, which needs sudo rights. Run git commands without `sudo` so that root needs no GitHub access and the clone stays yours; only the commands that install files use `sudo`.

### 4. Give the VM read access to the repo

A deploy key is an SSH key that can read this one repo and nothing else on your GitHub account. Create it on the VM:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/nomnoms_deploy -N "" -C "nomnoms-vm"
cat ~/.ssh/nomnoms_deploy.pub
```

On GitHub, open the repo and go to **Settings → Deploy keys → Add deploy key**. Paste the public key and leave **Allow write access** unticked. Then tell SSH to use the key for GitHub:

```sh
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/nomnoms_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com     # "Hi foshiee/nomnoms-recipe-website! You've successfully authenticated..."
```

The first connection asks you to confirm GitHub's host key. Compare the fingerprint with the ones listed on [GitHub's SSH key fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) page before typing `yes`.

### 5. Clone the repo

Clone it into your home directory. Never clone it into `/var/www`, where nginx would serve `.git/` and everything else in the repo.

```sh
git clone git@github.com:foshiee/nomnoms-recipe-website.git ~/nomnoms-recipe-website
cd ~/nomnoms-recipe-website
```

The steps below run from this folder. The repo's `.gitattributes` makes every checkout use LF line endings, which the systemd unit and `api.env` need.

### 6. Install the website

```sh
sudo install -d -m 0755 /var/www/nomnoms /var/www/nomnoms/recipes
sudo install -m 0644 var/www/nomnoms/index.html var/www/nomnoms/app.js var/www/nomnoms/style.css /var/www/nomnoms/
sudo restorecon -Rv /var/www/nomnoms   # SELinux labels
```

Recipe files go in `/var/www/nomnoms/recipes/`; see [recipe-format.md](recipe-format.md).

### 7. Create the service account and its data folder

```sh
sudo useradd --system --home-dir /var/lib/nomnoms --shell /sbin/nologin nomnoms
sudo install -d -m 0700 -o nomnoms -g nomnoms /var/lib/nomnoms
```

### 8. Install the service code

```sh
sudo mkdir -p /opt/nomnoms-api
sudo cp -r opt/nomnoms-api/. /opt/nomnoms-api/
cd /opt/nomnoms-api && sudo npm ci --omit=dev && cd -
```

`npm ci` installs the two dependencies (`@anthropic-ai/sdk` and `busboy`) at the exact versions in `package-lock.json`.

### 9. Let the service write recipes

This adds write access for `nomnoms` without changing who owns the folder, so you can still copy files in by hand:

```sh
sudo setfacl -m u:nomnoms:rwx /var/www/nomnoms/recipes
```

#### Optional: let an SFTP user upload recipes by hand

The folder is owned by root, so any other account (for example `recipeusr`, used with FileZilla) can read it but not upload to it. Give that account write access the same way. The second command sets default ACLs, so files created by either `recipeusr` or `nomnoms` stay writable by both. Without it, the import service may be unable to overwrite a recipe that was uploaded by hand.

```sh
sudo setfacl -m u:recipeusr:rwx /var/www/nomnoms/recipes
sudo setfacl -d -m u:recipeusr:rwx -m u:nomnoms:rwx /var/www/nomnoms/recipes
getfacl /var/www/nomnoms/recipes     # check both users are listed
```

If uploads still fail:

- **SELinux:** files uploaded over SFTP inherit the folder's label, so nginx can read them. If one isn't served, run `sudo restorecon -Rv /var/www/nomnoms`.
- **Chroot:** if `recipeusr` is chrooted or limited to `internal-sftp` in `sshd_config`, the chroot directory must be root-owned and not writable, so uploads must go into a writable subfolder.
- **Permissions:** `recipeusr` needs execute (`x`) on every parent folder. `/var/www/nomnoms` is `0755`, so this normally works.

### 10. Configuration

```sh
sudo install -d -m 0750 -o root -g nomnoms /etc/nomnoms
sudo install -m 0640 -o root -g nomnoms etc/nomnoms/api.env.example /etc/nomnoms/api.env
sudo nano /etc/nomnoms/api.env     # paste your key after ANTHROPIC_API_KEY=
```

No quotes or spaces around the key. If you leave it empty for now, everything except PDF, photo and text imports still works. Add it later and restart the service.

### 11. Create your login

Passwords need at least 12 characters. Run it from `/opt/nomnoms-api`, because the `nomnoms` account can't read your home directory.

```sh
cd /opt/nomnoms-api
sudo -u nomnoms USERS_FILE=/var/lib/nomnoms/users.json node tools/add-user.js yourname
cd -
```

### 12. Start the service

```sh
sudo install -m 0644 etc/systemd/system/nomnoms-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nomnoms-api
systemctl status nomnoms-api --no-pager      # should say "active (running)"
curl -s http://127.0.0.1:3000/api/me         # {"user":null}
```

The service listens only on `127.0.0.1`, so no firewall port needs opening for it.

### 13. SELinux

nginx needs permission to connect to the service:

```sh
sudo setsebool -P httpd_can_network_connect 1
```

### 14. nginx

```sh
sudo install -m 0644 etc/nginx/nginx.conf /etc/nginx/nginx.conf
sudo install -m 0644 etc/nginx/conf.d/nginx-nomnoms.conf /etc/nginx/conf.d/nomnoms.conf
sudo nano /etc/nginx/conf.d/nomnoms.conf     # set Traefik's address, uncomment the three real-IP lines
sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx
sudo firewall-cmd --permanent --add-service=http && sudo firewall-cmd --reload   # so Traefik can reach port 80
```

The main `nginx.conf` is the stock one with its sample server blocks commented out, so `nomnoms.conf` is the only site.

The address to use, and how to find it, is in the security checklist below.

### 15. Check it end to end

1. Open the site in a browser over HTTPS. There should be a small **Sign in** link at the bottom of the home page. If it isn't there, force-refresh the page (Ctrl+F5) to drop the cached `app.js`.
2. Click it and sign in. You should land on the import screen, and the home page should now show **Import recipe** at the top right.
3. Import a recipe web page, such as one from BBC Good Food or Allrecipes. The review screen should say *Read from the recipe data the web page publishes*.
4. Save it. You should land on the new recipe, and it should be on the home page.
5. If you set an API key, import a photo or PDF of a recipe as well. That checks the Claude path.
6. Watch it all in the log: `journalctl -u nomnoms-api -f`.

If the import page says *The import service isn't available on this server*, nginx can't reach the service. Check `systemctl status nomnoms-api`, the SELinux boolean from step 13, and `sudo tail /var/log/nginx/error.log`.

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
- **Updating:** in `~/nomnoms-recipe-website`, run `git pull --ff-only`. `git log --oneline ORIG_HEAD..` then lists what came in. Repeat setup step 6 for website changes. For service changes, run `sudo cp -r opt/nomnoms-api/. /opt/nomnoms-api/`, then `cd /opt/nomnoms-api && sudo npm ci --omit=dev`, then `sudo systemctl restart nomnoms-api`. Your users file, `api.env` and the recipes all live outside the clone, so updates don't touch them.

## Cost of Claude imports

Imports use `claude-sonnet-5-5` at medium effort by default. That model costs $2 per million input tokens and $10 per million output tokens. Most of the cost is the output, meaning the recipe itself plus the model's reasoning. Expect roughly 2 to 5 US cents per recipe, and more for a long multi-page PDF. These are estimates, so check real figures in the Anthropic console after your first few imports.

To change the model, set `MODEL` in `/etc/nomnoms/api.env` and restart the service (`sudo systemctl restart nomnoms-api`). If blurry photos or messy scanned PDFs come out wrong, `claude-opus-5-5` is more accurate at about twice the price.

## Trying it locally

On your own machine, no nginx is needed. The service can serve the site too, and it emulates nginx's JSON folder listing:

```sh
cd opt/nomnoms-api
npm install
USERS_FILE=./dev-users.json node tools/add-user.js tester
USERS_FILE=./dev-users.json RECIPES_DIR=../../var/www/nomnoms/recipes \
  DEV_STATIC_ROOT=../../var/www/nomnoms COOKIE_SECURE=false node server.js
```

Then open http://127.0.0.1:3000. On Windows PowerShell, set the variables with `$env:USERS_FILE = "./dev-users.json"` and so on. Recipes saved this way land in the repo's `var/www/nomnoms/recipes/` folder, so delete any test recipes before committing. `dev-users.json` is gitignored.

Tests for the parts that don't need Claude: `npm test`.
