#!/usr/bin/env bash
# End-to-end check against the real `dsh web`, in a throwaway DSH_HOME on a
# random port. Never touches the user's own home, profile or running GUI.
#
#   bash test/e2e.sh            # run and clean up
#   KEEP=1 bash test/e2e.sh     # leave the last server running for a browser check
set -uo pipefail

PLUGIN_DIR=$(cd "$(dirname "$0")/.." && pwd)
E2E_HOME=$(mktemp -d "${TMPDIR:-/tmp}/dsh-fixed-token-e2e.XXXXXX")
export DSH_HOME="$E2E_HOME" DSH_TELEMETRY_DISABLED=1
# Do not inherit the identity of a dsh process this script may run under.
unset DSH_PROFILE DSH_PROFILE_DIR DSH_WEB_URL DSH_SESSION_ID DSH_SHELL
WORK="$E2E_HOME/work"; mkdir -p "$WORK"
PATCH_FILE="$E2E_HOME/profiles/web/cordis.patch.yml"
SERVER_PID=""; FAILED=0

cleanup() {
  if [ -n "$SERVER_PID" ] && [ "${KEEP:-0}" != 1 ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; fi
  if [ "${KEEP:-0}" != 1 ]; then
    case "$E2E_HOME" in */dsh-fixed-token-e2e.*) rm -rf -- "${E2E_HOME:?}";; esac
  else
    echo "KEEP: home=$E2E_HOME pid=$SERVER_PID"
  fi
}
trap cleanup EXIT

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1: expected '$3', got '$2'"; fi; }

# start <log> [extra dsh args...] — sets URL, ORIGIN, TOKEN
start() {
  local log=$1; shift
  (cd "$WORK" && exec dsh --profile web "$@" --port 0 --no-open) >"$log" 2>&1 &
  SERVER_PID=$!
  URL=""
  for _ in $(seq 1 240); do
    URL=$(grep -o 'dsh web: http[^ ]*' "$log" | head -1 | sed 's/^dsh web: //')
    [ -n "$URL" ] && break
    kill -0 "$SERVER_PID" 2>/dev/null || break
    sleep 0.5
  done
  if [ -z "$URL" ]; then echo "--- server log ---"; cat "$log"; fail "dsh web did not print its URL"; exit 1; fi
  ORIGIN=$(python3 -c 'import sys,urllib.parse as u;p=u.urlsplit(sys.argv[1]);print(f"{p.scheme}://{p.netloc}")' "$URL")
  TOKEN=$(python3 -c 'import sys,urllib.parse as u;print(u.parse_qs(u.urlsplit(sys.argv[1]).query)["token"][0])' "$URL")
}
stop() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; }
status() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
saved_token() { grep -A3 'id: oheco-fixed-token' "$PATCH_FILE" 2>/dev/null | grep -o "token: ['\"]\?[A-Za-z0-9._~-]\{16,256\}" | head -1 | sed "s/token: ['\"]\?//"; }

echo "== install into $E2E_HOME (profile web)"
(cd "$WORK" && dsh plugin --profile web add "link:$PLUGIN_DIR") >"$E2E_HOME/install.log" 2>&1 || { cat "$E2E_HOME/install.log"; fail "dsh plugin add"; exit 1; }
if python3 -c 'import json,sys;sys.exit(0 if "@oheco/dsh-fixed-token" in json.load(open(sys.argv[1]))["dsh"]["profile"]["bundles"] else 1)' "$E2E_HOME/profiles/web/package.json"; then
  pass "bundle selected in profile package.json"
else
  fail "bundle not selected"; cat "$E2E_HOME/profiles/web/package.json"
fi
check "no token in the profile patch before first start" "$(saved_token)" ""

echo "== first start: generate, pin, save"
start "$E2E_HOME/run1.log"
T1=$TOKEN
[[ "$T1" =~ ^[A-Za-z0-9_-]{43}$ ]] && pass "printed URL carries a generated 43-char token" || fail "unexpected token shape"
for _ in $(seq 1 40); do [ -n "$(saved_token)" ] && break; sleep 0.25; done
check "generated token saved to profile cordis.patch.yml" "$(saved_token)" "$T1"
check "GET /?token=<fixed> -> 303" "$(status "$ORIGIN/?token=$T1")" 303
curl -s -D - -o /dev/null "$ORIGIN/?token=$T1" | grep -qi '^set-cookie: dsh-auth-' && pass "exchange sets the dsh-auth cookie" || fail "no dsh-auth cookie"
check "GET /?token=<wrong> -> 401" "$(status "$ORIGIN/?token=wrong-token-0000000000")" 401
check "GET / without credentials -> 401" "$(status "$ORIGIN/")" 401
check "GET /connect?token=<fixed> -> 302" "$(status "$ORIGIN/connect?token=$T1")" 302
check "GET /connect?token=<wrong> -> 401" "$(status "$ORIGIN/connect?token=wrong-token-0000000000")" 401
leaks=$(grep -v '^dsh web: ' "$E2E_HOME/run1.log" | grep -c -- "$T1")
check "token absent from every log line except the dsh web URL line" "$leaks" 0
# settings.update resolves only after the profile reload settles, a moment after the file write.
for _ in $(seq 1 40); do grep -q 'generated the initial fixed token' "$E2E_HOME/run1.log" && break; sleep 0.25; done
grep -q '^dsh fixed-token: generated the initial fixed token' "$E2E_HOME/run1.log" && pass "first-run save is announced on the console" || fail "first-run save not announced"
stop

echo "== second start: reuse"
start "$E2E_HOME/run2.log"
check "restart prints the same token" "$TOKEN" "$T1"
check "restart still accepts it" "$(status "$ORIGIN/?token=$T1")" 303
grep -q 'generated the initial fixed token' "$E2E_HOME/run2.log" && fail "regenerated on restart" || pass "no regeneration on restart"
check "saved token unchanged" "$(saved_token)" "$T1"
stop

echo "== manual edit of the profile patch"
python3 - "$PATCH_FILE" "$T1" <<'EOF'
import sys
path, old = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
assert old in text
open(path, 'w', encoding='utf-8').write(text.replace(old, 'hand-edited-fixed-token-42'))
EOF
start "$E2E_HOME/run3.log"
check "hand-edited token is printed" "$TOKEN" "hand-edited-fixed-token-42"
check "hand-edited token accepted" "$(status "$ORIGIN/?token=hand-edited-fixed-token-42")" 303
check "previous token rejected" "$(status "$ORIGIN/?token=$T1")" 401
stop

echo "== row disabled: back to the official random token"
printf -- '- id: oheco-fixed-token\n  disabled: true\n' >"$E2E_HOME/disable.yml"
start "$E2E_HOME/run4.log" --patch "$E2E_HOME/disable.yml"
[ "$TOKEN" != "hand-edited-fixed-token-42" ] && [[ "$TOKEN" =~ ^[A-Za-z0-9_-]{43}$ ]] && pass "disabled row prints a random token" || fail "disabled row still pinned ($TOKEN)"
check "fixed token rejected while disabled" "$(status "$ORIGIN/?token=hand-edited-fixed-token-42")" 401
check "random token accepted while disabled" "$(status "$ORIGIN/?token=$TOKEN")" 303
stop

echo "== hot load: install while dsh web is already running"
export DSH_HOME="$E2E_HOME/hot"; PATCH_FILE="$DSH_HOME/profiles/web/cordis.patch.yml"
start "$E2E_HOME/hot.log"
BEFORE=$TOKEN
(cd "$WORK" && dsh plugin --profile web add "link:$PLUGIN_DIR") >"$E2E_HOME/hot-install.log" 2>&1 || { cat "$E2E_HOME/hot-install.log"; fail "dsh plugin add while running"; }
for _ in $(seq 1 120); do [ -n "$(saved_token)" ] && break; sleep 0.5; done
HT=$(saved_token)
[[ "$HT" =~ ^[A-Za-z0-9_-]{43}$ ]] && pass "hot-loaded plugin saved a generated token" || fail "hot-loaded plugin saved no token"
check "running server accepts the saved token" "$(status "$ORIGIN/?token=$HT")" 303
check "launch token printed before the install is rejected" "$(status "$ORIGIN/?token=$BEFORE")" 401
grep -q 'cannot be nested' "$E2E_HOME/hot.log" && fail "nested HMR transaction reported" || pass "no nested HMR transaction"
stop

if [ "${KEEP:-0}" = 1 ]; then
  echo "== KEEP: leaving a server with the fixed token running"
  start "$E2E_HOME/keep.log"
  echo "KEEP_URL=$URL"
fi

[ "$FAILED" = 0 ] && echo "ALL E2E CHECKS PASSED" || { echo "SOME E2E CHECKS FAILED"; exit 1; }
