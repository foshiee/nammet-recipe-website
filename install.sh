#!/usr/bin/env bash
# Installs the site and the import service from this clone, following docs/install.md.
# Run it again after `git pull --ff-only` to update. It never touches your recipes,
# photos, users, settings or an existing /etc/nomnoms/api.env.
#
#   ./install.sh [--proxy ADDR[,ADDR]] [--cloudflare | --no-cloudflare] [--admin NAME | --no-admin] [--yes]
#
# Supports the RHEL family (Rocky, Alma, RHEL, CentOS Stream, Fedora) and Debian/Ubuntu.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Installs or updates the nomnoms site and import service on this machine.
Run it from the cloned repo as your normal user; it asks for sudo.

  --proxy ADDR[,ADDR]  The reverse proxy's IP address or CIDR range (Traefik, for
                       example), so nginx sees visitors' real addresses. Kept on updates;
                       --proxy '' clears it.
  --cloudflare         Also trust Cloudflare's address ranges. Kept on updates.
  --no-cloudflare      Stop trusting Cloudflare's address ranges.
  --admin NAME         Create this first admin (you're asked for the password).
  --no-admin           Don't create a first admin.
  --yes                Don't ask questions; use the defaults and the options given.
  --help               Show this help.
EOF
}

die() { echo "install.sh: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
note() { echo "    $*"; }

PROXY=
PROXY_SET=0
CLOUDFLARE=
ADMIN=
NO_ADMIN=0
YES=0
ARGS=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --proxy) [ $# -ge 2 ] || die "--proxy needs an address"; PROXY=$2; PROXY_SET=1; shift 2 ;;
    --proxy=*) PROXY=${1#*=}; PROXY_SET=1; shift ;;
    --cloudflare) CLOUDFLARE=1; shift ;;
    --no-cloudflare) CLOUDFLARE=0; shift ;;
    --admin) [ $# -ge 2 ] || die "--admin needs a user name"; ADMIN=$2; shift 2 ;;
    --admin=*) ADMIN=${1#*=}; shift ;;
    --no-admin) NO_ADMIN=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || die "run this as root, or install sudo"
  exec sudo -- "$(readlink -f "$0")" "${ARGS[@]}"
fi

INTERACTIVE=0
if [ -t 0 ] && [ "$YES" = 0 ]; then INTERACTIVE=1; fi

ask() { # ask "Question" default -> prints the answer
  local answer
  read -r -p "$1 " answer || true
  printf '%s' "${answer:-$2}"
}

# Addresses for nginx's set_real_ip_from: IPs or CIDR ranges only, comma-separated
clean_addrs() {
  local a
  a=$(printf '%s' "$1" | tr -d ' \t')
  case "$a" in *[!0-9A-Fa-f.:/,]*) die "not an IP address or CIDR range: $1" ;; esac
  printf '%s' "$a"
}

is_loopback() { case "$1" in 127.*|::1|::1/*) return 0 ;; *) return 1 ;; esac }

# Prefer the system Node at /usr/bin, which the systemd unit uses
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

node_major() {
  [ -x /usr/bin/node ] || { echo 0; return; }
  /usr/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

### 1. Preflight

REPO=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
case "$REPO/" in
  /var/www/*) die "the repo is under /var/www, where nginx could serve it. Clone it into your home directory instead." ;;
esac
for f in var/www/nomnoms/index.html var/www/nomnoms/app.js var/www/nomnoms/style.css var/www/nomnoms/robots.txt \
         opt/nomnoms-api/server.js opt/nomnoms-api/package-lock.json etc/nginx/conf.d/nginx-nomnoms.conf \
         etc/nginx/nginx.conf etc/systemd/system/nomnoms-api.service etc/nomnoms/api.env.example; do
  [ -f "$REPO/$f" ] || die "$f is missing. Run this from a complete clone of the repo."
done

[ -r /etc/os-release ] || die "can't read /etc/os-release. See docs/install.md to install by hand."
# shellcheck disable=SC1091
OS_ID=$(. /etc/os-release && echo "${ID:-} ${ID_LIKE:-}")
case " $OS_ID " in
  *" rhel "*|*" fedora "*|*" centos "*) FAMILY=rhel ;;
  *" debian "*|*" ubuntu "*) FAMILY=debian ;;
  *) die "unsupported distro ($OS_ID). See docs/install.md to install by hand." ;;
esac
command -v systemctl >/dev/null || die "systemd is needed."

UPDATE=0
[ -f /opt/nomnoms-api/server.js ] && UPDATE=1
if [ "$UPDATE" = 1 ]; then echo "Updating the existing install ($FAMILY family)."; else echo "Installing ($FAMILY family)."; fi

### 2. Packages

step "Packages"
if [ "$FAMILY" = rhel ]; then
  if [ "$(node_major)" -lt 20 ] && dnf -q module list nodejs 2>/dev/null | grep -qE '^nodejs +22 '; then
    note "Enabling the Node.js 22 module stream"
    dnf -y -q module reset nodejs
    dnf -y -q module enable nodejs:22
    if [ -x /usr/bin/node ]; then dnf -y -q distro-sync nodejs npm; fi
  fi
  dnf -y -q install nginx nodejs npm acl policycoreutils curl
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get -qq update
  apt-get -y -qq install nginx acl curl ca-certificates gnupg >/dev/null
  if [ "$(node_major)" -lt 20 ]; then
    candidate=$(apt-cache policy nodejs | awk '/Candidate:/ { print $2 }' | sed 's/^[0-9]*://; s/\..*//')
    if [ -n "$candidate" ] && [ "$candidate" != "(none)" ] && [ "$candidate" -ge 20 ] 2>/dev/null; then
      apt-get -y -qq install nodejs npm >/dev/null
    else
      note "Adding NodeSource's Node.js 22 repository"
      install -d -m 0755 /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list
      apt-get -qq update
      apt-get -y -qq install nodejs >/dev/null
    fi
  elif ! command -v npm >/dev/null; then
    apt-get -y -qq install npm >/dev/null
  fi
fi
[ "$(node_major)" -ge 20 ] || die "/usr/bin/node is missing or older than version 20."
note "Node.js $(/usr/bin/node --version)"

### 3. Service account and folders

step "Service account and folders"
if ! id nomnoms >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/nomnoms --shell "$(command -v nologin || echo /sbin/nologin)" nomnoms
  note "Created the nomnoms account"
fi
install -d -m 0700 -o nomnoms -g nomnoms /var/lib/nomnoms
install -d -m 0755 /var/www/nomnoms /var/www/nomnoms/recipes
install -d -m 0755 -o nomnoms -g nomnoms /var/www/nomnoms/theme /var/www/nomnoms/photos

### 4. Site files

step "Website"
install -m 0644 "$REPO"/var/www/nomnoms/{index.html,app.js,style.css,robots.txt} /var/www/nomnoms/
if [ "$UPDATE" = 0 ] && ! compgen -G '/var/www/nomnoms/recipes/*.json' >/dev/null; then
  install -m 0644 "$REPO/var/www/nomnoms/recipes/example-recipe.json" /var/www/nomnoms/recipes/
  install -m 0644 "$REPO/var/www/nomnoms/photos/example-recipe.jpg" /var/www/nomnoms/photos/
  note "Added the example recipe"
fi
if command -v restorecon >/dev/null; then restorecon -R /var/www/nomnoms; fi

### 5. Service code

step "Import service"
# Built beside the running copy and swapped in only once npm has succeeded
rm -rf /opt/nomnoms-api.new /opt/nomnoms-api.old
cp -r "$REPO/opt/nomnoms-api" /opt/nomnoms-api.new
rm -rf /opt/nomnoms-api.new/node_modules /opt/nomnoms-api.new/dev-*.json
chown -R root:root /opt/nomnoms-api.new
chmod -R u+rwX,go+rX,go-w /opt/nomnoms-api.new
(cd /opt/nomnoms-api.new && npm ci --omit=dev --no-audit --no-fund --loglevel=error) \
  || { rm -rf /opt/nomnoms-api.new; die "npm ci failed; the installed service was left as it was."; }
if [ -d /opt/nomnoms-api ]; then mv /opt/nomnoms-api /opt/nomnoms-api.old; fi
mv /opt/nomnoms-api.new /opt/nomnoms-api
rm -rf /opt/nomnoms-api.old

### 6. Let the service write recipes

setfacl -m u:nomnoms:rwx /var/www/nomnoms/recipes

### 7. api.env

step "Configuration"
install -d -m 0750 -o root -g nomnoms /etc/nomnoms
if [ -f /etc/nomnoms/api.env ]; then
  note "Kept /etc/nomnoms/api.env"
else
  KEY=
  if [ "$INTERACTIVE" = 1 ]; then
    echo "An Anthropic API key is needed only for PDF, photo and text imports. You can also add it"
    echo "later on the admin page. Leave it empty to skip."
    read -r -s -p "Anthropic API key: " KEY || true
    echo
    KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
  fi
  (umask 077 && KEY="$KEY" awk '/^ANTHROPIC_API_KEY=/ { print "ANTHROPIC_API_KEY=" ENVIRON["KEY"]; next } { print }' \
    "$REPO/etc/nomnoms/api.env.example" > /etc/nomnoms/api.env)
  unset KEY
  chown root:nomnoms /etc/nomnoms/api.env
  chmod 0640 /etc/nomnoms/api.env
  note "Created /etc/nomnoms/api.env"
fi

### 8. systemd

step "Starting the service"
install -m 0644 "$REPO/etc/systemd/system/nomnoms-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --quiet nomnoms-api
systemctl restart nomnoms-api

### 9. SELinux

if command -v getenforce >/dev/null && [ "$(getenforce)" != Disabled ]; then
  setsebool -P httpd_can_network_connect 1
  note "SELinux: let nginx connect to the service"
fi

### 10. nginx

step "nginx"
SITE=/etc/nginx/conf.d/nomnoms.conf
if [ "$PROXY_SET" = 0 ] && [ -f "$SITE" ]; then
  PROXY=$(awk '$1 == "set_real_ip_from" { sub(/;$/, "", $2); print $2 }' "$SITE" | paste -sd, -)
fi
if [ -z "$CLOUDFLARE" ]; then
  CLOUDFLARE=0
  if [ -f "$SITE" ] && grep -qE '^[[:space:]]*include /etc/nginx/cloudflare-ips\.inc;' "$SITE"; then CLOUDFLARE=1; fi
  if [ "$UPDATE" = 0 ] && [ "$INTERACTIVE" = 1 ] && [ "$CLOUDFLARE" = 0 ]; then
    case "$(ask "Is Cloudflare in front of the site? [y/N]" n)" in [Yy]*) CLOUDFLARE=1 ;; esac
  fi
fi
if [ -z "$PROXY" ] && [ "$UPDATE" = 0 ] && [ "$PROXY_SET" = 0 ] && [ "$INTERACTIVE" = 1 ]; then
  echo "nginx needs the reverse proxy's address (Traefik's, for example) to see visitors' real"
  echo "addresses. Use its IP, its Docker network's subnet such as 172.18.0.0/16, or 127.0.0.1 if"
  echo "it runs on this machine. See the security checklist in docs/install.md."
  PROXY=$(ask "Reverse proxy address (empty to skip):" "")
fi
PROXY=$(clean_addrs "$PROXY")

TEMPLATE="$REPO/etc/nginx/conf.d/nginx-nomnoms.conf"
for line in '# set_real_ip_from 192.0.2.10;' '# real_ip_header X-Forwarded-For;' '# real_ip_recursive on;' \
            '# include /etc/nginx/cloudflare-ips.inc;'; do
  grep -qF "$line" "$TEMPLATE" || die "the nginx config no longer has the line '$line'."
done

if [ "$CLOUDFLARE" = 1 ]; then
  CF_TMP=$(mktemp)
  { curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; echo; } \
    | grep -E '^[0-9a-f]' | sed 's/.*/set_real_ip_from &;/' > "$CF_TMP" || true
  if [ -s "$CF_TMP" ]; then
    install -m 0644 "$CF_TMP" /etc/nginx/cloudflare-ips.inc
    note "Wrote Cloudflare's ranges to /etc/nginx/cloudflare-ips.inc"
  elif [ ! -s /etc/nginx/cloudflare-ips.inc ]; then
    rm -f "$CF_TMP"
    die "couldn't download Cloudflare's address ranges."
  fi
  rm -f "$CF_TMP"
fi

NEW=$(mktemp)
awk -v addrs="$PROXY" -v cf="$CLOUDFLARE" '
  addrs != "" && /^[ \t]*# set_real_ip_from 192\.0\.2\.10;/ {
    n = split(addrs, a, ",")
    for (i = 1; i <= n; i++) if (a[i] != "") print "    set_real_ip_from " a[i] ";"
    next
  }
  addrs != "" && /^[ \t]*# real_ip_(header|recursive) / { sub(/# /, ""); print; next }
  cf == 1 && /^[ \t]*# include \/etc\/nginx\/cloudflare-ips\.inc;/ { sub(/# /, ""); print; next }
  { print }
' "$TEMPLATE" > "$NEW"

BACKUPS=()
SITE_EXISTED=0
if [ -f "$SITE" ]; then
  SITE_EXISTED=1
  if ! cmp -s "$SITE" "$NEW"; then
    cp -p "$SITE" "$SITE.bak"
    BACKUPS+=("$SITE")
    note "Changed $SITE (the old one is $SITE.bak):"
    if command -v diff >/dev/null; then diff -u "$SITE.bak" "$NEW" | sed 's/^/      /' || true; fi
  fi
fi
install -m 0644 "$NEW" "$SITE"
rm -f "$NEW"

if [ "$FAMILY" = rhel ]; then
  if ! cmp -s "$REPO/etc/nginx/nginx.conf" /etc/nginx/nginx.conf; then
    if [ -f /etc/nginx/nginx.conf ]; then
      cp -p /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak
      BACKUPS+=(/etc/nginx/nginx.conf)
    fi
    install -m 0644 "$REPO/etc/nginx/nginx.conf" /etc/nginx/nginx.conf
  fi
else
  # The distro's default site would clash with this one's default_server
  rm -f /etc/nginx/sites-enabled/default
fi
if command -v restorecon >/dev/null; then restorecon -R /etc/nginx; fi

if ! nginx -t -q; then
  for f in "${BACKUPS[@]}"; do cp -p "$f.bak" "$f"; done
  if [ "$SITE_EXISTED" = 0 ]; then rm -f "$SITE"; fi
  die "nginx rejected the new config, so the previous one was put back. See the errors above."
fi
systemctl enable --quiet nginx
systemctl reload-or-restart nginx

### 11. Firewall

FW_OPEN=0
if systemctl is-active --quiet firewalld 2>/dev/null; then
  step "Firewall (firewalld)"
  if [ -n "$PROXY" ]; then
    IFS=, read -r -a addrs <<< "$PROXY"
    for a in "${addrs[@]}"; do
      is_loopback "$a" && continue
      family=ipv4; case "$a" in *:*) family=ipv6 ;; esac
      firewall-cmd -q --permanent --add-rich-rule="rule family=\"$family\" source address=\"$a\" port port=\"80\" protocol=\"tcp\" accept" || true
      note "Port 80 open to $a"
    done
    firewall-cmd -q --permanent --remove-service=http 2>/dev/null || true
  else
    firewall-cmd -q --permanent --add-service=http || true
    FW_OPEN=1
  fi
  firewall-cmd -q --reload
elif command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  step "Firewall (ufw)"
  if [ -n "$PROXY" ]; then
    IFS=, read -r -a addrs <<< "$PROXY"
    for a in "${addrs[@]}"; do
      is_loopback "$a" && continue
      ufw allow from "$a" to any port 80 proto tcp >/dev/null
      note "Port 80 open to $a"
    done
  else
    ufw allow 80/tcp >/dev/null
    FW_OPEN=1
  fi
fi
if [ "$FW_OPEN" = 1 ]; then
  note "Port 80 is open to everyone. Once you know the reverse proxy's address, run this again"
  note "with --proxy so only it can connect."
fi

### 12. First admin

USERS_FILE=/var/lib/nomnoms/users.json
has_users() {
  [ -s "$USERS_FILE" ] && /usr/bin/node -e \
    'const u = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(Array.isArray(u) && u.length ? 0 : 1)' \
    "$USERS_FILE" 2>/dev/null
}
ADD_USER_CMD="cd /opt/nomnoms-api && sudo -u nomnoms USERS_FILE=$USERS_FILE node tools/add-user.js yourname --role admin"
if [ "$NO_ADMIN" = 0 ] && ! has_users; then
  step "First admin"
  if [ -z "$ADMIN" ] && [ "$INTERACTIVE" = 1 ]; then
    ADMIN=$(ask "User name for the first admin (empty to skip):" "")
  fi
  if [ -n "$ADMIN" ]; then
    echo "Passwords need at least 12 characters, with a lowercase letter, an uppercase letter, a number and a symbol. This one is temporary: you'll choose your own at your first sign-in."
    (cd /opt/nomnoms-api && sudo -u nomnoms USERS_FILE="$USERS_FILE" /usr/bin/node tools/add-user.js "$ADMIN" --role admin) \
      || note "Creating the admin failed. Try again with: $ADD_USER_CMD"
  else
    note "No users yet. Create the first admin with:"
    note "  $ADD_USER_CMD"
  fi
fi

### 13. Check and summary

step "Checking"
ok=0
for _ in $(seq 1 15); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/me >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" = 1 ]; then note "Service: running"; else note "Service: NOT answering. See: journalctl -u nomnoms-api -e"; fi
if curl -fsS --max-time 5 http://127.0.0.1/recipes/ 2>/dev/null | grep -q '"type"'; then
  note "nginx: serving the recipe list"
else
  note "nginx: NOT serving the recipe list. See: tail /var/log/nginx/error.log"
fi

if [ "$UPDATE" = 1 ]; then step "Updated"; else step "Installed"; fi
cat <<EOF
    The site is on port 80 of this machine. Put an HTTPS reverse proxy in front of it:
    sign-in only works over HTTPS while COOKIE_SECURE=true in /etc/nomnoms/api.env.
    Go through the security checklist in docs/install.md.
    Service log: journalctl -u nomnoms-api -f
    To update later: git pull --ff-only && ./install.sh
EOF
if [ -z "$PROXY" ] && [ "$CLOUDFLARE" = 0 ]; then
  echo "    No reverse proxy address set: rate limits will count every visitor as the proxy."
  echo "    Run this again with --proxy ADDR once you know it."
fi
