#!/bin/sh
# Checks a running site end to end: nginx, the recipe listing, the service and sign-in.
#   docker/smoke-test.sh http://127.0.0.1:8080
# Set SMOKE_USER and SMOKE_PASSWORD to an existing account (one with a temporary
# password is fine) to check signing in as well.
set -eu

BASE=${1:?usage: smoke-test.sh <base-url>}
BASE=${BASE%/}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
failed=0

pass() { echo "ok   $1"; }
fail() { echo "FAIL $1" >&2; failed=1; }

# status <file> <curl args...>: prints the HTTP status, saves the body to <file>
status() {
  out=$1
  shift
  curl -s -o "$out" -w '%{http_code}' --max-time 10 "$@" || true
}

code=$(status "$TMP/home" "$BASE/")
if [ "$code" = 200 ] && grep -q 'id="app"' "$TMP/home"; then pass "home page"; else fail "home page (HTTP $code)"; fi

code=$(status "$TMP/list" "$BASE/recipes/")
if [ "$code" = 200 ] && grep -q '"example-recipe.json"' "$TMP/list"; then pass "recipe listing"; else fail "recipe listing (HTTP $code)"; fi

code=$(status "$TMP/me" "$BASE/api/me")
if [ "$code" = 200 ] && grep -q '"user":null' "$TMP/me"; then pass "service (/api/me)"; else fail "service (/api/me, HTTP $code)"; fi

code=$(status "$TMP/theme" "$BASE/theme/theme.css")
if [ "$code" = 200 ]; then pass "generated theme"; else fail "generated theme (HTTP $code)"; fi

code=$(status "$TMP/bot" -A 'Mozilla/5.0 (compatible; GPTBot/1.2)' "$BASE/")
if [ "$code" = 403 ]; then pass "AI crawler blocked"; else fail "AI crawler blocked (HTTP $code)"; fi

code=$(status "$TMP/csrf" -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/login")
if [ "$code" = 403 ]; then pass "POST without X-Requested-With refused"; else fail "POST without X-Requested-With refused (HTTP $code)"; fi

if [ -n "${SMOKE_USER:-}" ]; then
  # The cookie is Secure, which curl won't send back over plain http by itself,
  # so it's read from the response headers and sent by hand.
  printf '{"username":"%s","password":"%s"}' "$SMOKE_USER" "${SMOKE_PASSWORD:?SMOKE_PASSWORD is needed with SMOKE_USER}" > "$TMP/login.json"
  code=$(status "$TMP/login" -D "$TMP/headers" -X POST -H 'Content-Type: application/json' \
    -H 'X-Requested-With: nammet' --data-binary "@$TMP/login.json" "$BASE/api/login")
  cookie=$(tr -d '\r' < "$TMP/headers" | sed -n 's/^[Ss]et-[Cc]ookie: \(nammet_session=[^;]*\).*/\1/p' | head -n 1)
  if [ "$code" = 200 ] && [ -n "$cookie" ]; then pass "sign in"; else fail "sign in (HTTP $code)"; fi

  code=$(status "$TMP/me2" -H "Cookie: $cookie" "$BASE/api/me")
  if [ "$code" = 200 ] && grep -q "\"username\":\"$SMOKE_USER\"" "$TMP/me2"; then pass "signed-in /api/me"; else fail "signed-in /api/me (HTTP $code)"; fi
fi

if [ "$failed" = 0 ]; then echo "All checks passed."; else echo "Some checks failed." >&2; fi
exit "$failed"
