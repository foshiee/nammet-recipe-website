#!/bin/sh
# Starts nginx and the import service together, or runs the command given instead
# (for example: docker run --rm -it -v nomnoms-data:/var/lib/nomnoms IMAGE add-user yourname).
#
# REAL_IP_FROM: the reverse proxy's addresses or CIDR ranges, comma-separated. They fill in
# the real-IP lines of the nginx config, so rate limits see each visitor's own address.
set -eu

TEMPLATE=/etc/nginx/nomnoms.conf.template
SITE=/etc/nginx/http.d/nomnoms.conf

# The service writes into these, and a bind-mounted host folder may belong to anyone.
# Only the folders themselves: the service writes a temp file and renames it into place,
# which needs write access to the folder but not to the files already in it.
chown node:node /var/www/nomnoms/recipes /var/www/nomnoms/photos /var/lib/nomnoms

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

render_nginx() {
  addrs=$(printf '%s' "${REAL_IP_FROM:-}" | tr -d ' \t')
  case "$addrs" in
    *[!0-9A-Fa-f.:/,]*)
      echo "REAL_IP_FROM can only hold IP addresses or CIDR ranges, separated by commas." >&2
      exit 1 ;;
  esac
  for line in '# set_real_ip_from 192.0.2.10;' '# real_ip_header X-Forwarded-For;' '# real_ip_recursive on;'; do
    if ! grep -qF "$line" "$TEMPLATE"; then
      echo "The nginx config no longer has the line '$line', so REAL_IP_FROM can't be applied." >&2
      exit 1
    fi
  done
  awk -v addrs="$addrs" '
    addrs != "" && /^[ \t]*# set_real_ip_from 192\.0\.2\.10;/ {
      n = split(addrs, a, ",")
      for (i = 1; i <= n; i++) if (a[i] != "") print "    set_real_ip_from " a[i] ";"
      next
    }
    addrs != "" && /^[ \t]*# real_ip_(header|recursive) / { sub(/# /, ""); print; next }
    { print }
  ' "$TEMPLATE" > "$SITE"
}

render_nginx
nginx -t -q

stopping=0
node_pid=
nginx_pid=
stop() {
  stopping=1
  kill -TERM "$node_pid" "$nginx_pid" 2>/dev/null || true
}
trap stop TERM INT

su-exec node node /opt/nomnoms-api/server.js &
node_pid=$!
nginx -g 'daemon off;' &
nginx_pid=$!

# If either one stops, stop the other too, so Docker's restart policy restarts both.
while kill -0 "$node_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done
[ "$stopping" = 1 ] || echo "nomnoms: a process exited unexpectedly, stopping." >&2
kill -TERM "$node_pid" "$nginx_pid" 2>/dev/null || true
wait "$node_pid" 2>/dev/null || true
wait "$nginx_pid" 2>/dev/null || true
[ "$stopping" = 1 ] || exit 1
