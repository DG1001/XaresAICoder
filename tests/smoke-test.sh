#!/bin/bash

# XaresAICoder Smoke Test
# Exercises a running installation end to end through nginx: login (incl. the
# per-client limit behind a reverse proxy), workspace lifecycle, group users,
# network isolation, both proxies, Forgejo and, with --backup, backup.sh with
# a restore. Run by CI after ./deploy.sh
# (.github/workflows/smoke-test.yml); also works against a local installation
# and removes what it created (workspaces zz-smoke-*, their Forgejo users,
# group user zz-smoke-user).
#
# Usage: tests/smoke-test.sh [--backup]
#   --backup   also back up and restore the platform (stops it for a moment)

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

WITH_BACKUP=false
case "${1:-}" in
    "") ;;
    --backup) WITH_BACKUP=true ;;
    *) echo "Usage: $0 [--backup]"; exit 1 ;;
esac

if [ ! -f .env ]; then
    echo "No .env found - deploy XaresAICoder first"
    exit 1
fi
env_value() {
    grep "^$1=" .env | tail -1 | cut -d'=' -f2-
}
BASE_DOMAIN=$(env_value BASE_DOMAIN)
BASE_DOMAIN=${BASE_DOMAIN:-localhost}
HOST_PORT=$(env_value HOST_PORT)
HOST_PORT=${HOST_PORT:-80}
HOST_PORT=${HOST_PORT##*:}  # port of a loopback binding like 127.0.0.1:8080
ENABLE_PROXY=$(env_value ENABLE_PROXY)
ENABLE_GIT_SERVER=$(env_value ENABLE_GIT_SERVER)
WAIT=300  # seconds a workspace may take to come up

PASSED=0
FAILED=0
CREATED=()         # workspaces to delete on exit
FORGEJO_USERS=()   # their Forgejo users, purged on exit
GROUP_USERS=()     # group user ids, deleted on exit
COOKIES=$(mktemp)
GROUP_COOKIES=$(mktemp)
BACKUP_DIR=""

ok() { echo -e "  ${GREEN}✔${NC} $1"; PASSED=$((PASSED + 1)); }
bad() { echo -e "  ${RED}✘${NC} $1"; FAILED=$((FAILED + 1)); }
section() { echo; echo -e "${BLUE}== $1${NC}"; }
# check DESCRIPTION COMMAND...: passes when the command succeeds
check() {
    local description="$1"
    shift
    if "$@"; then ok "$description"; else bad "$description"; fi
}
one_of() {
    local value="$1" option
    shift
    for option in "$@"; do [ "$value" = "$option" ] && return 0; done
    return 1
}
files_exist() {
    local file
    for file in "$@"; do [ -f "$file" ] || return 1; done
}
container_gone() {
    ! docker inspect "$1" >/dev/null 2>&1
}

# curl to nginx on this host for one of the installation's host names
http() {
    local host="$1"
    shift
    curl -s --max-time 30 --resolve "$host:$HOST_PORT:127.0.0.1" -b "$COOKIES" -c "$COOKIES" "$@"
}
# api METHOD PATH [JSON] - sets STATUS and BODY; the body goes via stdin so
# passwords stay out of the process list
api() {
    local out
    out=$(printf '%s' "${3:-}" | http "$BASE_DOMAIN" -X "$1" -H 'Content-Type: application/json' \
        ${3:+--data-binary @-} -w '\n%{http_code}' "http://$BASE_DOMAIN:$HOST_PORT/api$2")
    STATUS=${out##*$'\n'}
    BODY=${out%$'\n'*}
}
# Python expression on the JSON in BODY (as d)
json() {
    python3 -c 'import json, sys
d = json.loads(sys.argv[2])
v = eval(sys.argv[1])
print("" if v is None else v)' "$1" "$BODY" 2>/dev/null
}
# Forgejo admin API with the credentials from .env (curl config via stdin)
forgejo_api() {
    local method="$1" path="$2"
    printf 'user = "%s:%s"\n' "$(env_value GIT_ADMIN_USER)" "$(env_value GIT_ADMIN_PASSWORD)" |
        http "$BASE_DOMAIN" -K - -X "$method" -o /dev/null -w '%{http_code}' \
            "http://$BASE_DOMAIN:$HOST_PORT/git/api/v1$path"
}

forgejo_user_exists() {
    [ -n "$1" ] && [ "$(forgejo_api GET "/users/$1")" = 200 ]
}

login() {
    api POST /auth/login "$(python3 -c 'import json, sys; print(json.dumps({"password": sys.argv[1]}))' "$(env_value ADMIN_PASSWORD)")"
    [ "$STATUS" = 200 ]
}
# as_group COMMAND...: run with the group user's session instead of the admin's
as_group() {
    local COOKIES=$GROUP_COOKIES
    "$@"
}

wait_health() {
    local i
    for i in $(seq 1 30); do
        api GET /health
        [ "$STATUS" = 200 ] && return 0
        sleep 2
    done
    return 1
}

wait_forgejo() {
    local i
    for i in $(seq 1 45); do
        [ "$(http "$BASE_DOMAIN" -o /dev/null -w '%{http_code}' "http://$BASE_DOMAIN:$HOST_PORT/git/")" = 200 ] && return 0
        sleep 2
    done
    return 1
}

# Waits until the API reports the workspace as running (WS_STATUS: last status)
wait_running() {
    local i
    WS_STATUS=""
    for i in $(seq 1 $((WAIT / 5))); do
        api GET "/projects/$1"
        WS_STATUS=$(json 'd["project"]["status"]')
        [ "$WS_STATUS" = running ] && return 0
        [ "$WS_STATUS" = error ] && return 1
        sleep 5
    done
    return 1
}

# create_workspace NAME PROXY_MODE - sets WS_ID
create_workspace() {
    WS_ID=""
    api POST /projects/create "{\"projectName\":\"$1\",\"projectType\":\"empty\",\"proxyMode\":\"$2\"}"
    if [ "$STATUS" != 201 ]; then
        bad "Create $1 (HTTP $STATUS: $(json 'd.get("message")'))"
        return 1
    fi
    WS_ID=$(json 'd["project"]["projectId"]')
    CREATED+=("$WS_ID")
    wait_running "$WS_ID"
    local result=$?
    # The container is created asynchronously, so look for its user only now
    local user=$(forgejo_user_of "$WS_ID")
    [ -z "$user" ] || FORGEJO_USERS+=("$user")
    if [ "$result" = 0 ]; then
        ok "Workspace $1 created and running"
    else
        bad "Workspace $1 not running (status: ${WS_STATUS:-unknown})"
        return 1
    fi
}

forgejo_user_of() {
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "workspace-$1" 2>/dev/null |
        sed -n 's/^FORGEJO_USER=//p'
}

delete_workspace() {
    local id="$1" kept=() other
    api DELETE "/projects/$id"
    for other in "${CREATED[@]}"; do [ "$other" = "$id" ] || kept+=("$other"); done
    CREATED=("${kept[@]+"${kept[@]}"}")
    [ "$STATUS" = 200 ]
}

# HTTP status of a request from inside a workspace (its own proxy settings)
ws_http_code() {
    local id="$1"
    shift
    docker exec -u coder "workspace-$id" curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"
}

cleanup() {
    local id user
    for id in "${CREATED[@]+"${CREATED[@]}"}"; do
        api DELETE "/projects/$id"
    done
    for user in "${FORGEJO_USERS[@]+"${FORGEJO_USERS[@]}"}"; do
        forgejo_api DELETE "/admin/users/$user?purge=true" >/dev/null
    done
    for user in "${GROUP_USERS[@]+"${GROUP_USERS[@]}"}"; do
        api DELETE "/users/$user"
    done
    rm -f "$COOKIES" "$GROUP_COOKIES"
    [ -z "$BACKUP_DIR" ] || rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

echo "XaresAICoder smoke test against http://$BASE_DOMAIN:$HOST_PORT (proxy: ${ENABLE_PROXY:-false}, Git server: ${ENABLE_GIT_SERVER:-false})"

section "Platform"
# deploy.sh may just have recreated the API server (Forgejo password rotation)
check "API health" wait_health
api GET /projects/
check "API locked without login (HTTP $STATUS)" [ "$STATUS" = 401 ]
if ! login; then
    bad "Admin login (HTTP $STATUS)"
    echo "Cannot continue without a login"
    exit 1
fi
ok "Admin login"
api GET /projects/
check "Project list" [ "$STATUS" = 200 ]
code=$(http "$BASE_DOMAIN" -o /dev/null -w '%{http_code}' "http://$BASE_DOMAIN:$HOST_PORT/")
check "Dashboard (HTTP $code)" [ "$code" = 200 ]
code=$(http "unknown-smoke.$BASE_DOMAIN" -o /dev/null -w '%{http_code}' "http://unknown-smoke.$BASE_DOMAIN:$HOST_PORT/")
check "Unknown subdomain answers 404 (HTTP $code)" [ "$code" = 404 ]
if [ "$ENABLE_GIT_SERVER" = true ]; then
    check "Forgejo reachable under /git/" wait_forgejo
    if [ "$(env_value GIT_REQUIRE_SIGNIN_VIEW)" != false ]; then
        code=$(curl -s --max-time 30 --resolve "$BASE_DOMAIN:$HOST_PORT:127.0.0.1" -o /dev/null -w '%{http_code}' \
            "http://$BASE_DOMAIN:$HOST_PORT/git/api/v1/repos/search")
        check "Forgejo shows no repositories without a login (HTTP $code)" [ "$code" = 403 ]
    fi
fi

section "Workspace without proxy"
if create_workspace zz-smoke-direct none; then
    id=$WS_ID
    code=$(http "$id.$BASE_DOMAIN" -o /dev/null -w '%{http_code}' "http://$id.$BASE_DOMAIN:$HOST_PORT/")
    check "VS Code reachable through nginx (HTTP $code)" one_of "$code" 200 302
    # Login shell for the PATH; it also prints a welcome, hence the marker
    missing=$(docker exec -u coder "workspace-$id" bash -lc \
        'for t in code-server claude codex copilot opencode crush pi info update_ai_agents; do command -v $t >/dev/null || echo "missing:$t"; done' 2>/dev/null |
        sed -n 's/^missing://p')
    check "AI tools installed${missing:+ (missing: $(echo $missing))}" [ -z "$missing" ]
    missing=$(docker exec -u coder "workspace-$id" code-server --list-extensions 2>/dev/null |
        awk 'BEGIN { split("saoudrizwan.claude-dev anthropic.claude-code", want) }
             { have[tolower($0)] = 1 }
             END { for (i in want) if (!have[want[i]]) print want[i] }')
    check "AI extensions installed${missing:+ (missing: $(echo $missing))}" [ -z "$missing" ]
    owner=$(docker exec "workspace-$id" stat -c %U /opt/ai-tools/lib/node_modules 2>/dev/null)
    check "AI tools updatable without sudo (/opt/ai-tools owned by ${owner:-?})" [ "$owner" = coder ]
    max_size=$(docker inspect -f '{{index .HostConfig.LogConfig.Config "max-size"}}' "workspace-$id")
    check "Docker log limit set (max-size ${max_size:-none})" [ -n "$max_size" ]
    code=$(ws_http_code "$id" -H "Host: $BASE_DOMAIN" http://xaresaicoder-nginx/api/health)
    check "Platform API blocked from the workspace (HTTP $code)" [ "$code" = 403 ]
    # nginx trusts X-Forwarded-For only from the Docker host, not from workspaces
    code=$(ws_http_code "$id" -H "Host: $BASE_DOMAIN" -H "X-Forwarded-For: 203.0.113.9" http://xaresaicoder-nginx/api/health)
    check "Forged X-Forwarded-For from the workspace ignored (HTTP $code)" [ "$code" = 403 ]
    if [ "$ENABLE_GIT_SERVER" = true ]; then
        user=$(forgejo_user_of "$id")
        check "Own Forgejo user ${user:-missing}" forgejo_user_exists "$user"
    fi
    api POST "/projects/$id/stop"
    check "Stop (HTTP $STATUS)" [ "$STATUS" = 200 ]
    check "Container stopped" [ "$(docker inspect -f '{{.State.Running}}' "workspace-$id")" = false ]
    api POST "/projects/$id/start"
    check "Start (HTTP $STATUS)" [ "$STATUS" = 200 ]
    check "Running again" wait_running "$id"

    section "Group users"
    api PUT "/projects/$id/group" '{"group":"zz-smoke-group"}'
    check "Workspace moved to group zz-smoke-group (HTTP $STATUS)" [ "$STATUS" = 200 ]
    password=$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))')
    api POST /users "{\"username\":\"zz-smoke-user\",\"password\":\"$password\",\"groups\":[\"zz-smoke-group\"]}"
    user_id=$(json 'd["user"]["id"]')
    [ -z "$user_id" ] || GROUP_USERS+=("$user_id")
    check "User created (HTTP $STATUS)" [ "$STATUS" = 201 ]
    as_group api POST /auth/login "{\"username\":\"zz-smoke-user\",\"password\":\"$password\"}"
    check "Login as group user (HTTP $STATUS, role $(json 'd.get("role")'))" [ "$(json 'd.get("role")')" = group ]
    as_group api GET /projects/
    check "List shows only the group's workspace" [ "$(json "[p['projectId'] for p in d['projects']] == ['$id']")" = True ]
    as_group api POST /projects/create '{}'
    check "Creating workspaces forbidden (HTTP $STATUS)" [ "$STATUS" = 403 ]
    as_group api GET /users
    check "User management forbidden (HTTP $STATUS)" [ "$STATUS" = 403 ]
    as_group api PUT "/projects/$id/name" '{"name":"zz-smoke-renamed"}'
    check "Rename (HTTP $STATUS)" [ "$STATUS" = 200 ]
    as_group api PUT "/projects/$id/notes" '{"notes":"smoke test"}'
    check "Edit notes (HTTP $STATUS)" [ "$STATUS" = 200 ]
    as_group api POST "/projects/$id/stop"
    check "Stop as group user (HTTP $STATUS)" [ "$STATUS" = 200 ]
    as_group api POST "/projects/$id/start"
    check "Start as group user (HTTP $STATUS)" [ "$STATUS" = 200 ]
    api PUT "/projects/$id/group" '{"group":"Uncategorized"}'
    as_group api GET "/projects/$id"
    check "Workspace outside the user's groups hidden (HTTP $STATUS)" [ "$STATUS" = 404 ]
    api PUT "/users/$user_id" "{\"password\":\"$password-new\"}"
    as_group api GET /projects/
    check "New password ends the user's session (HTTP $STATUS)" [ "$STATUS" = 401 ]
    api DELETE "/users/$user_id"
    check "User deleted (HTTP $STATUS)" [ "$STATUS" = 200 ]
    [ "$STATUS" = 200 ] && GROUP_USERS=()

    check "Delete" delete_workspace "$id"
    check "Container removed" container_gone "workspace-$id"
fi

if [ "$ENABLE_PROXY" = true ]; then
    section "Security Proxy"
    if create_workspace zz-smoke-security security; then
        id=$WS_ID
        code=$(ws_http_code "$id" http://pypi.org/)
        check "Whitelisted domain allowed (pypi.org: HTTP $code)" one_of "$code" 200 301 302
        code=$(ws_http_code "$id" http://example.com/)
        check "Other domain blocked (example.com: HTTP $code)" [ "$code" = 403 ]
        code=$(ws_http_code "$id" --noproxy '*' http://example.com/)
        check "No direct internet access (HTTP $code)" [ "$code" = 000 ]
        check "Delete" delete_workspace "$id"
    fi

    section "LLM Logging Proxy"
    if create_workspace zz-smoke-logging logging; then
        id=$WS_ID
        code=$(ws_http_code "$id" http://example.com/)
        check "Unrestricted through mitmproxy (example.com: HTTP $code)" [ "$code" = 200 ]
        code=$(ws_http_code "$id" --noproxy '*' http://example.com/)
        check "No direct internet access (HTTP $code)" [ "$code" = 000 ]
        api GET "/projects/$id/recorded-domains"
        check "Domain recorded" [ "$(json '"example.com" in d["domains"]')" = True ]
        ip=$(json 'd["ipAddress"]')
        check "Delete" delete_workspace "$id"
        # Recorded domains of the IP are only reset when it is reused
        [ -z "$ip" ] || docker exec xaresaicoder-mitmproxy-logger rm -f "/var/log/mitmproxy/domains/$ip.json"
    fi
fi

# Requests from this host reach nginx from a Docker gateway, as those of a
# reverse proxy in front would: nginx takes the client from X-Forwarded-For,
# so ten wrong passwords block that client only (before the restore, which
# restarts the server and so forgets the blocked client)
section "Login limit behind a reverse proxy"
wrong_login() {
    http "$BASE_DOMAIN" -o /dev/null -w '%{http_code}' -H "X-Forwarded-For: $1" \
        -H 'Content-Type: application/json' -d '{"password":"zz-smoke-wrong"}' \
        "http://$BASE_DOMAIN:$HOST_PORT/api/auth/login"
}
client_a="203.0.113.$((RANDOM % 254 + 1))"
client_b="198.51.100.$((RANDOM % 254 + 1))"
for _ in $(seq 1 10); do wrong_login "$client_a" >/dev/null; done
code=$(wrong_login "$client_a")
check "Client blocked after ten wrong passwords (HTTP $code)" [ "$code" = 429 ]
code=$(wrong_login "$client_b")
check "Other client behind the same proxy not blocked (HTTP $code)" [ "$code" = 401 ]
api GET /projects/
check "Own session unaffected (HTTP $STATUS)" [ "$STATUS" = 200 ]

if [ "$WITH_BACKUP" = true ]; then
    section "Backup and restore"
    BACKUP_DIR=$(mktemp -d)
    server=$(docker ps -q --filter label=com.docker.compose.service=server | head -1)
    projects_before=$(docker exec "$server" md5sum /app/workspaces/projects.json | cut -d' ' -f1)
    if ./backup.sh --dir "$BACKUP_DIR" --keep 0 > "$BACKUP_DIR/backup.log" 2>&1; then
        ok "backup.sh"
        backup=$(ls -d "$BACKUP_DIR"/xares-*)
        check "Backup contains .env, CA and workspace_data" \
            files_exist "$backup/MANIFEST" "$backup/env" "$backup/certs.tgz" "$backup/volumes/workspace_data.tgz"
        if ./backup.sh --dir "$BACKUP_DIR" --restore "$backup" --yes > "$BACKUP_DIR/restore.log" 2>&1; then
            ok "backup.sh --restore"
            check "API back after the restore" wait_health
            check "Login after the restore" login
            server=$(docker ps -q --filter label=com.docker.compose.service=server | head -1)
            check "projects.json restored unchanged" \
                [ "$(docker exec "$server" md5sum /app/workspaces/projects.json | cut -d' ' -f1)" = "$projects_before" ]
            if [ "$ENABLE_GIT_SERVER" = true ]; then
                check "Forgejo back after the restore" wait_forgejo
            fi
        else
            bad "backup.sh --restore"
            sed 's/^/    /' "$BACKUP_DIR/restore.log"
        fi
    else
        bad "backup.sh"
        sed 's/^/    /' "$BACKUP_DIR/backup.log"
    fi
fi

echo
if [ "$FAILED" -gt 0 ]; then
    echo -e "${RED}$FAILED of $((PASSED + FAILED)) checks failed${NC}"
    exit 1
fi
echo -e "${GREEN}All $PASSED checks passed${NC}"
