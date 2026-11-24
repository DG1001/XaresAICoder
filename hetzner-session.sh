#!/usr/bin/env bash

# XaresAICoder on a temporary Hetzner Cloud server.
#
#   ./hetzner-session.sh init            write a config template and exit
#   ./hetzner-session.sh up [--yes]      rent a server, install XaresAICoder, wildcard HTTPS
#   ./hetzner-session.sh status [--show-password]
#   ./hetzner-session.sh ssh [command]   shell on the server
#   ./hetzner-session.sh down [--backup|--no-backup] [--yes]
#                                        (backup), clear DuckDNS, DELETE the server
#
# Hetzner bills cloud servers per hour as long as they exist (also when
# powered off), so `down` deletes the server. See docs/DEPLOYMENT.md
# ("Temporary Hetzner Cloud session").

set -euo pipefail
umask 077  # state, certificates and backups contain secrets

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${XARES_HETZNER_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/xares-hetzner/config.env}"
STATE_DIR="${XARES_HETZNER_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/xares-hetzner}"
STATE_FILE="$STATE_DIR/session.env"
# Test hooks (a fake API in place of the real services)
HCLOUD_API="${HCLOUD_API:-https://api.hetzner.cloud/v1}"
DUCKDNS_API="${DUCKDNS_API:-https://www.duckdns.org}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
print_status()  { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }
die() { print_error "$1"; exit 1; }

ASSUME_YES=false
BACKUP_CHOICE=""      # yes | no | "" = ask
SHOW_PASSWORD=false
UP_RUNNING=0
HDR_FILE=""
RESP=""
HC_CODE=""
SERVER_ID=""; SERVER_IP=""; FQDN=""; STARTED_AT=""; S_TYPE=""; S_LOCATION=""; S_PRICE=""; S_STAGING="0"

# ---------------------------------------------------------------- helpers

confirm() {
    $ASSUME_YES && return 0
    [ -t 0 ] || die "$1 -- not a terminal, pass --yes to confirm"
    local reply
    read -r -p "$1 [y/N] " reply || reply=""
    [[ $reply =~ ^[YyJj]$ ]]
}

# Hetzner API: hc METHOD PATH [JSON]; body in $RESP, status in $HC_CODE.
# The token travels in a header file (not in the process list).
hc() {
    local method=$1 path=$2 body=${3:-}
    local args=(-sS -X "$method" -H "@$HDR_FILE" -o "$RESP" -w '%{http_code}' --max-time 60)
    [ -n "$body" ] && args+=(--data-binary "$body")
    HC_CODE=$(curl "${args[@]}" "$HCLOUD_API$path") || die "Hetzner API not reachable"
}

# Python snippet on the last API answer ($RESP) as `d`; the snippets are constants.
jp() {
    python3 -I -c "import json,sys
d=json.load(open(sys.argv[1]))
$1" "$RESP"
}

hc_error() { jp 'e=d.get("error") or {}
print((e.get("code") or "?")+": "+(e.get("message") or ""))' 2>/dev/null || echo "HTTP $HC_CODE"; }

hc_ok() { case $HC_CODE in 2??) return 0 ;; *) return 1 ;; esac; }

json_obj() { python3 -I -c "import json,sys
a=sys.argv[1:]
$1" "${@:2}"; }

duckdns() {  # $1 = IP address, or "clear"
    local extra="&ip=$1" out
    [ "$1" = clear ] && extra="&clear=true"
    out=$(printf 'url = "%s/update?domains=%s&token=%s%s"\n' "$DUCKDNS_API" "$DUCKDNS_SUBDOMAIN" "$DUCKDNS_TOKEN" "$extra" \
        | curl -sS --max-time 30 -K -) || return 1
    [ "$out" = OK ]
}

SSH_OPTS=()
rssh() { ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" "$@"; }

load_config() {
    [ -f "$CONFIG_FILE" ] || die "No config at $CONFIG_FILE -- run: $0 init"
    if [ -n "$(find "$CONFIG_FILE" -perm /077 2>/dev/null)" ]; then
        print_warning "$CONFIG_FILE is readable by others (tokens inside) -- chmod 600 it"
    fi
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"

    [ -n "${HCLOUD_TOKEN:-}" ]  || die "HCLOUD_TOKEN missing in $CONFIG_FILE"
    [ -n "${DUCKDNS_TOKEN:-}" ] || die "DUCKDNS_TOKEN missing in $CONFIG_FILE"
    [ -n "${ACME_EMAIL:-}" ]    || die "ACME_EMAIL missing in $CONFIG_FILE"
    DUCKDNS_SUBDOMAIN=$(echo "${DUCKDNS_SUBDOMAIN:-}" | tr 'A-Z' 'a-z')
    DUCKDNS_SUBDOMAIN=${DUCKDNS_SUBDOMAIN%.duckdns.org}
    [[ $DUCKDNS_SUBDOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] \
        || die "DUCKDNS_SUBDOMAIN missing or invalid in $CONFIG_FILE (the name only, e.g. myxares)"
    FQDN="$DUCKDNS_SUBDOMAIN.duckdns.org"

    SERVER_TYPE=${SERVER_TYPE:-}
    MIN_RAM_GB=${MIN_RAM_GB:-32}
    LOCATIONS=${LOCATIONS:-"fsn1 nbg1 hel1"}
    ADMIN_CIDR=${ADMIN_CIDR:-}
    SSH_PUBKEY=${SSH_PUBKEY:-}
    WS_MAX=${WS_MAX:-10}
    WS_CPU=${WS_CPU:-2}
    WS_MEM_MB=${WS_MEM_MB:-4096}
    DEPLOY_ARGS=${DEPLOY_ARGS---git-server}
    CADDY_VERSION=${CADDY_VERSION:-2.10.0}
    ACME_STAGING=${ACME_STAGING:-0}
    BACKUP_DIR=${BACKUP_DIR:-$HOME/xares-backups/hetzner}
}

prepare_runtime() {
    mkdir -p "$STATE_DIR"
    HDR_FILE=$(mktemp "$STATE_DIR/hdr.XXXXXX")
    RESP=$(mktemp "$STATE_DIR/resp.XXXXXX")
    printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$HCLOUD_TOKEN" > "$HDR_FILE"
    SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new
              -o UserKnownHostsFile="$STATE_DIR/known_hosts" -o ServerAliveInterval=15
              -o ConnectTimeout=10 -o LogLevel=ERROR)
    local key=${SSH_PUBKEY%.pub}
    [ -n "$key" ] && [ -f "$key" ] && SSH_OPTS+=(-i "$key" -o IdentitiesOnly=yes)
    return 0
}

save_state() {
    {
        for v in SERVER_ID SERVER_IP FQDN STARTED_AT S_TYPE S_LOCATION S_PRICE S_STAGING; do
            printf '%s=%q\n' "$v" "${!v}"
        done
    } > "$STATE_FILE"
}

load_state() {
    [ -f "$STATE_FILE" ] || return 1
    # shellcheck disable=SC1090
    . "$STATE_FILE"
}

on_exit() {
    local rc=$?
    rm -f "$HDR_FILE" "$RESP" 2>/dev/null || true
    if [ "$UP_RUNNING" = 1 ] && [ $rc -ne 0 ] && [ -f "$STATE_FILE" ]; then
        UP_RUNNING=0
        echo
        print_warning "Setup failed -- the server (id $SERVER_ID) still exists and costs money."
        if [ -t 0 ]; then
            local reply
            read -r -p "Delete the server now? [y/N] " reply || reply=""
            if [[ $reply =~ ^[YyJj]$ ]]; then
                HDR_FILE=$(mktemp "$STATE_DIR/hdr.XXXXXX"); RESP=$(mktemp "$STATE_DIR/resp.XXXXXX")
                printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$HCLOUD_TOKEN" > "$HDR_FILE"
                delete_server && duckdns clear || true
                rm -f "$STATE_FILE" "$HDR_FILE" "$RESP"
                print_success "Server deleted."
                return
            fi
        fi
        print_warning "Look around with '$0 ssh' (log: /var/log/xares-deploy.log), delete with '$0 down'."
    fi
}
trap on_exit EXIT

# ---------------------------------------------------------------- Hetzner

list_types() {  # $1 location, $2 wanted type name (empty = candidates); name cores ram disk cpu_type price/h
    python3 -I -c '
import json,sys
d=json.load(open(sys.argv[1])); minram=float(sys.argv[2]); loc=sys.argv[3]; want=sys.argv[4]
rows=[]
for t in d["server_types"]:
    if want:
        if t["name"]!=want: continue
    else:
        if t.get("architecture")!="x86" or t["memory"]<minram: continue
        if t.get("deprecated") or t.get("deprecation"): continue
    price=None
    for p in t.get("prices",[]):
        if p["location"]==loc: price=float(p["price_hourly"]["gross"])
    if price is None: continue
    rows.append((price,t["name"],t["cores"],t["memory"],t["disk"],t.get("cpu_type","?")))
rows.sort()
for r in rows: print("\t".join([r[1],str(r[2]),"%g"%r[3],str(r[4]),r[5],"%.4f"%r[0]]))
' "$RESP" "$MIN_RAM_GB" "$1" "$2"
}

choose_server_type() {
    local first_loc=${LOCATIONS%% *} row
    hc GET "/server_types?per_page=50"
    hc_ok || die "Could not read server types: $(hc_error)"
    if [ -n "$SERVER_TYPE" ]; then
        row=$(list_types "$first_loc" "$SERVER_TYPE" | head -n1 || true)
        if [ -z "$row" ]; then
            print_error "'$SERVER_TYPE' is no Hetzner Cloud server type at $first_loc."
            print_error "(EX/AX/RX... are dedicated Robot servers: monthly billing, setup fee, no cloud API.)"
            print_error "Cloud types with at least $MIN_RAM_GB GB RAM (type, vCPU, GB RAM, GB disk, CPU, EUR/h incl. VAT):"
            list_types "$first_loc" "" | head -n 8 | tr '\t' ' ' | sed 's/^/    /' >&2
            exit 1
        fi
    else
        local rows=()
        mapfile -t rows < <(list_types "$first_loc" "")
        [ ${#rows[@]} -gt 0 ] || die "No x86 cloud type with >= $MIN_RAM_GB GB RAM found at $first_loc"
        print_status "Cheapest x86 cloud types with >= $MIN_RAM_GB GB RAM at $first_loc:"
        printf '    %-8s %5s %6s %7s %-10s %s\n' type vCPU "RAM GB" "disk" cpu "EUR/h (incl. VAT)"
        local r
        for r in "${rows[@]:0:5}"; do
            IFS=$'\t' read -r a b c d e f <<< "$r"
            printf '    %-8s %5s %6s %7s %-10s %s\n' "$a" "$b" "$c" "$d" "$e" "$f"
        done
        row=${rows[0]}
    fi
    local cores ram disk cpu
    IFS=$'\t' read -r S_TYPE cores ram disk cpu S_PRICE <<< "$row"
    print_status "Selected: $S_TYPE ($cores vCPU, $ram GB RAM, $disk GB disk) -- about $S_PRICE EUR per hour incl. VAT"
}

ensure_ssh_key() {  # sets KEY_ID
    local pub=$SSH_PUBKEY f
    if [ -z "$pub" ]; then
        for f in "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/id_ecdsa.pub" "$HOME/.ssh/id_rsa.pub"; do
            [ -f "$f" ] && { pub=$f; break; }
        done
    fi
    [ -f "$pub" ] || die "No SSH public key found (set SSH_PUBKEY in $CONFIG_FILE)"
    SSH_PUBKEY=$pub
    local key=${pub%.pub}
    [ -f "$key" ] && SSH_OPTS+=(-i "$key" -o IdentitiesOnly=yes)

    hc GET "/ssh_keys?per_page=50"
    hc_ok || die "Could not read SSH keys: $(hc_error)"
    KEY_ID=$(python3 -I -c '
import json,sys
d=json.load(open(sys.argv[1])); mine=open(sys.argv[2]).read().split()[:2]
for k in d["ssh_keys"]:
    if k["public_key"].split()[:2]==mine: print(k["id"]); break
' "$RESP" "$pub")
    if [ -z "$KEY_ID" ]; then
        hc POST /ssh_keys "$(json_obj 'print(json.dumps({"name":a[0],"public_key":open(a[1]).read().strip()}))' "xares-session-$(date +%s)" "$pub")"
        hc_ok || die "Could not upload the SSH key: $(hc_error)"
        KEY_ID=$(jp 'print(d["ssh_key"]["id"])')
        print_status "Uploaded SSH key $(basename "$pub") to the Hetzner project"
    fi
}

ensure_firewall() {  # sets FW_ID: 22 (ADMIN_CIDR), 80, 443, ping
    local rules
    rules=$(json_obj '
ssh=a[0].split() or ["0.0.0.0/0","::/0"]
anyip=["0.0.0.0/0","::/0"]
r=[{"direction":"in","protocol":"tcp","port":"22","source_ips":ssh},
   {"direction":"in","protocol":"tcp","port":"80","source_ips":anyip},
   {"direction":"in","protocol":"tcp","port":"443","source_ips":anyip},
   {"direction":"in","protocol":"icmp","source_ips":anyip}]
print(json.dumps(r))' "$ADMIN_CIDR")
    hc GET "/firewalls?name=xares-session"
    hc_ok || die "Could not read firewalls: $(hc_error)"
    FW_ID=$(jp 'print(d["firewalls"][0]["id"] if d["firewalls"] else "")')
    if [ -z "$FW_ID" ]; then
        hc POST /firewalls "{\"name\":\"xares-session\",\"rules\":$rules}"
        hc_ok || die "Could not create the firewall: $(hc_error)"
        FW_ID=$(jp 'print(d["firewall"]["id"])')
    else
        hc POST "/firewalls/$FW_ID/actions/set_rules" "{\"rules\":$rules}"
        hc_ok || die "Could not update the firewall rules: $(hc_error)"
    fi
}

create_server() {
    local user_data body loc name="xares-session-$(date +%Y%m%d-%H%M)"
    user_data=$(cat <<'EOF'
#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, docker-buildx, git, ca-certificates, curl]
runcmd:
  - systemctl enable --now docker
EOF
)
    for loc in $LOCATIONS; do
        body=$(json_obj '
print(json.dumps({"name":a[0],"server_type":a[1],"image":"ubuntu-24.04","location":a[2],
  "ssh_keys":[int(a[3])],"firewalls":[{"firewall":int(a[4])}],"user_data":a[5],
  "labels":{"xares-session":"true"},"start_after_create":True}))' \
            "$name" "$S_TYPE" "$loc" "$KEY_ID" "$FW_ID" "$user_data")
        hc POST /servers "$body"
        if hc_ok; then
            SERVER_ID=$(jp 'print(d["server"]["id"])')
            S_LOCATION=$loc
            STARTED_AT=$(date +%s)
            save_state   # from here on `down` knows the server
            UP_RUNNING=1
            print_success "Server $name created ($S_TYPE at $loc, id $SERVER_ID)"
            return 0
        fi
        local err; err=$(hc_error)
        case $err in
            *unavailable*|*placement*|*not_available*) print_warning "$S_TYPE not available at $loc ($err), trying the next location" ;;
            *) die "Could not create the server: $err" ;;
        esac
    done
    die "$S_TYPE is not available in any of: $LOCATIONS (set LOCATIONS or SERVER_TYPE in $CONFIG_FILE)"
}

wait_running() {
    local i st
    for i in $(seq 1 80); do
        hc GET "/servers/$SERVER_ID"
        hc_ok || die "Could not read the server: $(hc_error)"
        st=$(jp 'print(d["server"]["status"])')
        SERVER_IP=$(jp 'print(((d["server"].get("public_net") or {}).get("ipv4") or {}).get("ip") or "")')
        [ "$st" = running ] && [ -n "$SERVER_IP" ] && { save_state; print_success "Server running at $SERVER_IP"; return 0; }
        sleep 3
    done
    die "Server did not reach 'running' in 4 minutes"
}

delete_server() {
    local i
    hc DELETE "/servers/$SERVER_ID"
    case $HC_CODE in 2??|404) ;; *) print_error "Could not delete server $SERVER_ID: $(hc_error)"; return 1 ;; esac
    for i in $(seq 1 40); do
        hc GET "/servers/$SERVER_ID"
        [ "$HC_CODE" = 404 ] && return 0
        sleep 3
    done
    print_error "Server $SERVER_ID still exists after 2 minutes -- check the Hetzner console"
    return 1
}

# ---------------------------------------------------------------- install

wait_ssh() {
    local deadline=$((SECONDS + ${SSH_WAIT_SECS:-300}))
    print_status "Waiting for SSH..."
    until rssh true 2>/dev/null; do
        [ $SECONDS -lt $deadline ] || die "SSH on $SERVER_IP did not come up"
        sleep 5
    done
    print_status "Waiting for cloud-init (Docker install)..."
    rssh 'cloud-init status --wait >/dev/null 2>&1; true'
    rssh 'docker compose version >/dev/null 2>&1' || die "Docker is not installed on the server (see /var/log/cloud-init-output.log)"
}

upload_source() {
    git -C "$SCRIPT_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "$SCRIPT_DIR is not a git checkout"
    print_status "Uploading the working tree (tracked and untracked files, no ignored ones)..."
    git -C "$SCRIPT_DIR" ls-files -z --cached --others --exclude-standard \
        | tar --null --ignore-failed-read --exclude=backups -C "$SCRIPT_DIR" -T - -czf - \
        | rssh 'mkdir -p /opt/xares && tar xzf - -C /opt/xares'
}

start_deploy() {
    {
        printf 'FQDN=%q\nWS_MAX=%q\nWS_CPU=%q\nWS_MEM_MB=%q\nDEPLOY_ARGS=%q\n' \
            "$FQDN" "$WS_MAX" "$WS_CPU" "$WS_MEM_MB" "$DEPLOY_ARGS"
        cat <<'EOF'
set -euo pipefail
cd /opt/xares
[ -f .env ] || cp .env.example .env
set_env() {
    if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
# TLS ends at Caddy on the host; XaresAICoder's nginx only listens on loopback
set_env BASE_DOMAIN "$FQDN"
set_env BASE_PORT 443
set_env PROTOCOL https
set_env HOST_PORT 127.0.0.1:8080
set_env MAX_WORKSPACES_PER_USER "$WS_MAX"
set_env MAX_CONCURRENT_WORKSPACES "$WS_MAX"
set_env CPU_PER_WORKSPACE "$WS_CPU"
set_env MEMORY_PER_WORKSPACE_MB "$WS_MEM_MB"
chmod 600 .env
rm -f /var/lib/xares-deploy.rc
setsid nohup bash -c "./deploy.sh --skip-env $DEPLOY_ARGS --rebuild </dev/null >/var/log/xares-deploy.log 2>&1; echo \$? >/var/lib/xares-deploy.rc" </dev/null >/dev/null 2>&1 &
EOF
    } | rssh 'bash -s'
}

setup_caddy() {
    local dir; dir=$(mktemp -d "$STATE_DIR/caddy.XXXXXX")
    local staging_line=""
    [ "$ACME_STAGING" = 1 ] && staging_line=$'\n\tacme_ca https://acme-staging-v02.api.letsencrypt.org/directory'
    cat > "$dir/Dockerfile" <<EOF
FROM caddy:${CADDY_VERSION}-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns
FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
EOF
    # The apex gets its own certificate (HTTP/TLS challenge) so that only the
    # wildcard needs a DNS TXT record: DuckDNS holds a single TXT record.
    cat > "$dir/Caddyfile" <<EOF
{
	email ${ACME_EMAIL}${staging_line}
}

(xares) {
	reverse_proxy 127.0.0.1:8080 {
		flush_interval -1
	}
}

${FQDN} {
	import xares
}

*.${FQDN} {
	tls {
		dns duckdns {env.DUCKDNS_TOKEN}
	}
	import xares
}
EOF
    printf 'DUCKDNS_TOKEN=%s\n' "$DUCKDNS_TOKEN" > "$dir/env"
    print_status "Building Caddy ${CADDY_VERSION} with the DuckDNS plugin..."
    tar -C "$dir" -czf - Dockerfile Caddyfile env | rssh 'mkdir -p /opt/xares-caddy && tar xzf - -C /opt/xares-caddy && chmod 600 /opt/xares-caddy/env'
    rm -rf "$dir"
    rssh 'docker build -q -t xares-caddy:local /opt/xares-caddy >/dev/null' </dev/null \
        || die "Caddy build failed"
    local saved; saved=$(cert_backup_file)
    if [ -f "$saved" ]; then
        print_status "Restoring the saved certificates (avoids new Let's Encrypt orders)"
        rssh 'docker volume create xares-caddy-data >/dev/null && docker run --rm -i -v xares-caddy-data:/data --entrypoint tar xares-caddy:local xzf - -C /data' < "$saved" \
            || print_warning "Could not restore the saved certificates"
    fi
    rssh 'docker rm -f xares-caddy >/dev/null 2>&1; docker run -d --name xares-caddy --restart unless-stopped --network host \
        -v /opt/xares-caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v xares-caddy-data:/data -v xares-caddy-config:/config \
        --env-file /opt/xares-caddy/env xares-caddy:local >/dev/null' </dev/null \
        || die "Caddy did not start"
}

cert_backup_file() {
    local staging_tag=""; [ "$S_STAGING" = 1 ] && staging_tag="-staging"
    echo "$STATE_DIR/caddy-data-${FQDN}${staging_tag}.tgz"
}

wait_deploy() {
    print_status "deploy.sh is running on the server (image builds take several minutes)..."
    local out last=""
    while :; do
        out=$(rssh 'if [ -f /var/lib/xares-deploy.rc ]; then echo "RC=$(cat /var/lib/xares-deploy.rc)"; else tail -n 1 /var/log/xares-deploy.log 2>/dev/null | cut -c1-110; fi' </dev/null) \
            || { sleep 10; continue; }
        case $out in
            RC=0) print_success "XaresAICoder deployed"; return 0 ;;
            RC=*) print_error "deploy.sh failed (exit ${out#RC=}), end of the log:"
                  rssh 'tail -n 40 /var/log/xares-deploy.log' </dev/null | grep -vi password >&2 || true
                  die "Deployment failed" ;;
            *assword*) ;;
            *) [ "$out" != "$last" ] && [ -n "$out" ] && echo "    ... $out"; last=$out ;;
        esac
        sleep 10
    done
}

wait_https() {
    local opts=(-sS --max-time 10 -o /dev/null -w '%{http_code}') apex=000 wild=000
    [ "$S_STAGING" = 1 ] && opts+=(-k)
    print_status "Waiting for Let's Encrypt (apex and wildcard certificate)..."
    local deadline=$((SECONDS + 600))
    while [ $SECONDS -lt $deadline ]; do
        apex=$(curl "${opts[@]}" --resolve "$FQDN:443:$SERVER_IP" "https://$FQDN/api/health" 2>/dev/null || true)
        wild=$(curl "${opts[@]}" --resolve "probe.$FQDN:443:$SERVER_IP" "https://probe.$FQDN/" 2>/dev/null || true)
        [ "$apex" = 200 ] && [ "$wild" != 000 ] && { print_success "HTTPS works for $FQDN and *.$FQDN"; return 0; }
        sleep 10
    done
    print_error "No valid certificate after 10 minutes (apex: $apex, wildcard: $wild). Caddy log:"
    rssh 'docker logs --tail 30 xares-caddy 2>&1' </dev/null | sed 's/^/    /' >&2 || true
    die "HTTPS setup failed"
}

admin_password() { rssh "grep '^ADMIN_PASSWORD=' /opt/xares/.env | cut -d= -f2-" </dev/null; }

cost_estimate() {  # prints "<h>h<m>m, about <eur> EUR"
    python3 -I -c '
import sys,math,time
start=int(sys.argv[1]); price=float(sys.argv[2]); s=int(time.time())-start
print("%dh%02dm, about %.2f EUR (hours are billed started)" % (s//3600,(s%3600)//60,math.ceil(s/3600)*price))
' "$STARTED_AT" "$S_PRICE"
}

# ---------------------------------------------------------------- commands

cmd_init() {
    mkdir -p "$(dirname "$CONFIG_FILE")"
    if [ -f "$CONFIG_FILE" ]; then
        print_status "Config exists: $CONFIG_FILE"
        return 0
    fi
    cat > "$CONFIG_FILE" <<'EOF'
# Hetzner Cloud API token: console -> project -> Security -> API tokens (read & write)
HCLOUD_TOKEN=
# DuckDNS: the name only ("myxares" -> myxares.duckdns.org) and your account token
DUCKDNS_SUBDOMAIN=
DUCKDNS_TOKEN=
# Contact address for Let's Encrypt
ACME_EMAIL=

# --- optional (defaults shown) ---
# SERVER_TYPE=                  # empty: cheapest x86 cloud type with MIN_RAM_GB
# MIN_RAM_GB=32
# LOCATIONS="fsn1 nbg1 hel1"    # tried in this order
# ADMIN_CIDR=                   # who may SSH, e.g. "203.0.113.7/32" (default: everybody, key only)
# SSH_PUBKEY=                   # default: ~/.ssh/id_ed25519.pub, id_ecdsa.pub, id_rsa.pub
# WS_MAX=10                     # MAX_CONCURRENT_WORKSPACES / MAX_WORKSPACES_PER_USER
# WS_CPU=2                      # CPU_PER_WORKSPACE (largest choice per workspace)
# WS_MEM_MB=4096                # MEMORY_PER_WORKSPACE_MB (largest choice per workspace)
# DEPLOY_ARGS="--git-server"    # more deploy.sh flags, e.g. "--git-server --enable-proxy"
# CADDY_VERSION=2.10.0
# ACME_STAGING=0                # 1 = Let's Encrypt staging (test run, browsers distrust it)
# BACKUP_DIR=$HOME/xares-backups/hetzner
EOF
    chmod 600 "$CONFIG_FILE"
    print_success "Wrote $CONFIG_FILE -- fill in the tokens, then run: $0 up"
}

cmd_up() {
    load_config
    prepare_runtime
    local c; for c in curl python3 ssh tar git; do command -v "$c" >/dev/null || die "$c is required"; done
    [ -f "$STATE_FILE" ] && die "A session is already recorded ($STATE_FILE). Use '$0 status' or '$0 down'."
    hc GET "/servers?label_selector=xares-session"
    hc_ok || die "Hetzner API: $(hc_error) (token wrong or without write access?)"
    [ "$(jp 'print(len(d["servers"]))')" = 0 ] || die "A server labelled xares-session exists already in this Hetzner project: run '$0 down'"

    S_STAGING=$ACME_STAGING
    choose_server_type
    confirm "Rent $S_TYPE now and install XaresAICoder at https://$FQDN ?" || die "Aborted"
    ensure_ssh_key
    ensure_firewall
    create_server
    wait_running

    duckdns "$SERVER_IP" || die "DuckDNS update failed (token or subdomain wrong?)"
    print_success "$FQDN and *.$FQDN now point to $SERVER_IP"

    wait_ssh
    upload_source
    start_deploy
    setup_caddy
    wait_deploy
    wait_https

    local pw; pw=$(admin_password)
    UP_RUNNING=0
    echo
    print_success "XaresAICoder is up."
    echo "  URL:       https://$FQDN"
    echo "  Login:     admin password  $pw"
    echo "  Workspaces: https://<id>.$FQDN"
    echo "  Server:    $S_TYPE at $S_LOCATION, $SERVER_IP (about $S_PRICE EUR/h incl. VAT)"
    echo "  Shell:     $0 ssh"
    echo "  Stop:      $0 down --backup     (deletes the server; billing stops)"
    [ "$S_STAGING" = 1 ] && print_warning "ACME_STAGING=1: browsers will show a certificate warning"
    return 0
}

cmd_status() {
    load_config
    prepare_runtime
    if ! load_state; then
        print_status "No session recorded."
        hc GET "/servers?label_selector=xares-session"
        hc_ok && [ "$(jp 'print(len(d["servers"]))')" != 0 ] \
            && print_warning "...but the Hetzner project has a server labelled xares-session (run '$0 down')"
        return 0
    fi
    echo "  URL:      https://$FQDN"
    echo "  Server:   $S_TYPE at $S_LOCATION, $SERVER_IP (id $SERVER_ID)"
    echo "  Running:  $(cost_estimate)"
    hc GET "/servers/$SERVER_ID"
    [ "$HC_CODE" = 404 ] && print_warning "Hetzner no longer knows this server (deleted elsewhere?) -- '$0 down' cleans up"
    if $SHOW_PASSWORD; then echo "  Admin password: $(admin_password)"; fi
    return 0
}

cmd_ssh() {
    load_config
    prepare_runtime
    load_state || die "No session recorded"
    if [ $# -eq 0 ]; then rssh -t; else rssh "$@"; fi
}

do_backup() {
    local dest="$BACKUP_DIR/$FQDN-$(date +%Y%m%d-%H%M%S)" name
    print_status "Backing up on the server (backup.sh --workspaces)..."
    rssh 'cd /opt/xares && ./backup.sh --workspaces --keep 0 >/var/log/xares-backup.log 2>&1' </dev/null \
        || { print_error "backup.sh failed on the server (/var/log/xares-backup.log)"; return 1; }
    name=$(rssh 'basename "$(ls -1dt /opt/xares/backups/xares-* | head -n 1)"' </dev/null)
    mkdir -p "$dest"
    print_status "Copying $name to $dest ..."
    rssh "tar czf - -C /opt/xares/backups '$name'" </dev/null | tar xzf - -C "$dest" || return 1
    print_success "Backup saved: $dest/$name"
}

cmd_down() {
    load_config
    prepare_runtime
    if ! load_state; then
        hc GET "/servers?label_selector=xares-session"
        hc_ok || die "Hetzner API: $(hc_error)"
        local rows; rows=$(jp 'for s in d["servers"]: print(s["id"],s["name"])')
        [ -n "$rows" ] || { print_status "Nothing to do: no session and no labelled server."; return 0; }
        echo "Servers labelled xares-session without a recorded session:"; echo "$rows" | sed 's/^/    /'
        confirm "Delete all of them?" || die "Aborted"
        local id
        for id in $(echo "$rows" | cut -d' ' -f1); do SERVER_ID=$id; delete_server && print_success "Deleted $id"; done
        duckdns clear && print_status "Cleared $FQDN at DuckDNS"
        return 0
    fi

    echo "  Server:   $S_TYPE at $S_LOCATION, $SERVER_IP (id $SERVER_ID)"
    echo "  Running:  $(cost_estimate)"
    local reachable=false
    rssh true </dev/null 2>/dev/null && reachable=true
    if $reachable; then
        local choice=$BACKUP_CHOICE
        if [ -z "$choice" ]; then
            if $ASSUME_YES; then choice=no
            elif confirm "Back up the workspaces to $BACKUP_DIR first? (the server's files are gone after the delete)"; then choice=yes
            else choice=no; fi
        fi
        if [ "$choice" = yes ]; then
            do_backup || confirm "Backup failed. Delete the server anyway?" || die "Aborted -- server still running"
        fi
        # Keep the certificates: Let's Encrypt allows only a few identical orders per week
        local cf; cf=$(cert_backup_file)
        rssh 'docker run --rm -v xares-caddy-data:/data --entrypoint tar xares-caddy:local czf - -C /data .' </dev/null > "$cf.tmp" 2>/dev/null \
            && [ -s "$cf.tmp" ] && mv "$cf.tmp" "$cf" && print_status "Certificates saved for the next session"
        rm -f "$cf.tmp"
    else
        print_warning "Server not reachable over SSH -- no backup possible."
    fi
    confirm "Delete the server $SERVER_ID now? Everything on it is lost." || die "Aborted -- server still running"

    duckdns clear && print_status "Cleared $FQDN at DuckDNS (no dangling record on a reusable IP)" \
        || print_warning "Could not clear the DuckDNS record"
    delete_server || die "Server not deleted -- billing continues!"
    rm -f "$STATE_FILE"
    # An auto-created primary IP goes with the server; an unassigned one would keep billing
    hc GET "/primary_ips?per_page=50"
    if hc_ok; then
        local orphans; orphans=$(jp 'print(" ".join(p["ip"] for p in d["primary_ips"] if not p.get("assignee_id")))')
        [ -z "$orphans" ] || print_warning "Unassigned primary IPs in the project (they bill hourly): $orphans -- delete them in the Hetzner console if you don't need them"
    fi
    print_success "Server deleted -- no more charges, nothing else is left running. Total: $(cost_estimate)"
}

usage() { sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; }

main() {
    local cmd=${1:-}; [ $# -gt 0 ] && shift
    case $cmd in
        init)   cmd_init ;;
        up|status|down)
            local a
            for a in "$@"; do
                case $a in
                    --yes|-y) ASSUME_YES=true ;;
                    --backup) BACKUP_CHOICE=yes ;;
                    --no-backup) BACKUP_CHOICE=no ;;
                    --show-password) SHOW_PASSWORD=true ;;
                    *) die "Unknown option: $a" ;;
                esac
            done
            "cmd_$cmd" ;;
        ssh)    cmd_ssh "$@" ;;
        ""|-h|--help|help) usage ;;
        *)      usage; die "Unknown command: $cmd" ;;
    esac
}

main "$@"
