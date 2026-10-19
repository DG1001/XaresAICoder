#!/bin/bash

# XaresAICoder Backup Script
# Backs up the platform data (.env, proxy CA, volumes) and on request the
# files of the workspaces, which live in their containers (no volumes).
# Restores the platform data or the files of single workspaces.

set -e
set -o pipefail
umask 077  # backups contain secrets (.env, CA key, AI tool logins)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Platform data on volumes (squid_logs only holds logs)
VOLUMES="workspace_data forgejo_data nginx_dynamic squid_whitelist mitmproxy_logs"
FORGEJO_CONTAINER=xaresaicoder-forgejo
# Left out of workspace homes: caches, what the image brings along again, and
# the code-server login of the container (it belongs to the workspace, not to
# its files, and must survive a restore into another workspace)
HOME_EXCLUDES="coder/.cache coder/.npm coder/.local/share/code-server/extensions
coder/.local/share/code-server/CachedExtensionVSIXs coder/.opencode/bin
coder/.code-server-auth coder/.config/code-server/config.yaml"

WORK_DIR=""
FORGEJO_STOPPED=false
WORKSPACES_FAILED=0
ASSUME_YES=false

show_usage() {
    echo "Usage: $0 [--dir DIR] [--keep N] [--workspaces]"
    echo "       $0 --restore BACKUP [--yes]"
    echo "       $0 --restore-workspace BACKUP PROJECT_ID [--into PROJECT_ID] [--yes]"
    echo
    echo "Options:"
    echo "  --dir DIR             Directory for the backups (default: ./backups)"
    echo "  --keep N              Keep the newest N backups, delete older ones (default: 7, 0 = keep all)"
    echo "  --workspaces          Also back up /workspace and /home/coder of every workspace"
    echo "  --restore BACKUP      Restore .env, proxy CA and volumes (stops the platform)"
    echo "  --restore-workspace BACKUP PROJECT_ID"
    echo "                        Copy a workspace's files from BACKUP back into its container"
    echo "  --into PROJECT_ID     With --restore-workspace: copy into another (new) workspace"
    echo "  --yes                 Do not ask before restoring"
    echo "  --help                Show this help message"
    echo
    echo "Examples:"
    echo "  $0                                 # Platform data, keep 7 backups"
    echo "  $0 --workspaces --keep 14          # Including workspace files"
    echo "  $0 --restore backups/xares-20261019-030000"
    echo "  $0 --restore-workspace backups/xares-20261019-030000 <old-id> --into <new-id>"
    echo
    echo "Nightly via cron:"
    echo "  0 3 * * * cd $SCRIPT_DIR && ./backup.sh >> backups/backup.log 2>&1"
    echo
}

# Value of a key in .env (empty if unset)
env_value() {
    [ -f .env ] || return 0
    grep "^$1=" .env | tail -1 | cut -d'=' -f2- || true
}

container_running() {
    [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]
}

confirm() {
    [ "$ASSUME_YES" = true ] && return 0
    local reply
    read -p "$1 (y/N): " -n 1 -r reply || return 1
    echo
    [[ $reply =~ ^[Yy]$ ]]
}

start_forgejo_again() {
    if [ "$FORGEJO_STOPPED" = true ]; then
        FORGEJO_STOPPED=false
        docker start "$FORGEJO_CONTAINER" >/dev/null && print_status "Forgejo started again"
    fi
}

cleanup() {
    start_forgejo_again
    if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
        rm -rf "$WORK_DIR"
        print_error "Backup incomplete, removed $(basename "$WORK_DIR")"
    fi
}

# Packs a volume (numeric owners) into $2. tar runs in a throwaway container
# of the helper image; the archive is handed over to the calling user.
backup_volume() {
    local volume="$1" file="$2"
    docker run --rm --network none -v "$volume":/data:ro -v "$(dirname "$file")":/backup \
        --entrypoint sh "$HELPER_IMAGE" -c \
        'tar -czf "/backup/$1" --numeric-owner -C /data . && chown "$2" "/backup/$1" && chmod 600 "/backup/$1"' \
        sh "$(basename "$file")" "$(id -u):$(id -g)"
}

# Empties a volume (created if missing, labelled like Compose does) and
# unpacks $2 into it
restore_volume() {
    local volume="$1" file="$2" name="$3"
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
        docker volume create --label "com.docker.compose.project=$PROJECT" \
            --label "com.docker.compose.volume=$name" "$volume" >/dev/null
    fi
    docker run --rm --network none -v "$volume":/data -v "$(dirname "$file")":/backup:ro \
        --entrypoint sh "$HELPER_IMAGE" -c \
        'find /data -mindepth 1 -delete && tar -xzf "/backup/$1" --numeric-owner -C /data' \
        sh "$(basename "$file")"
}

# /workspace as is, /home/coder without HOME_EXCLUDES (docker cp also works
# on stopped containers; the helper unpacks without the excluded paths and
# packs again). Called in an if, so every step checks its result itself.
backup_workspace() {
    local container="$1" out="$2" excludes="" path
    for path in $HOME_EXCLUDES; do excludes="$excludes --exclude=$path"; done
    mkdir -p "$out" || return 1
    docker cp "$container:/workspace" - | gzip > "$out/workspace.tgz" || return 1
    docker cp "$container:/home/coder" - | docker run --rm -i --network none -v "$out":/backup \
        --entrypoint sh "$HELPER_IMAGE" -c \
        'owner=$1; shift
         mkdir /x && tar -x -f - --numeric-owner -C /x "$@" &&
         tar -cz -f /backup/home.tgz --numeric-owner -C /x coder &&
         chown "$owner" /backup/home.tgz && chmod 600 /backup/home.tgz' \
        sh "$(id -u):$(id -g)" $excludes || return 1
}

backup_workspaces() {
    local dir="$1/workspaces" container
    local containers=$(docker ps -a --filter name=^workspace- --format '{{.Names}}' | sort)
    if [ -z "$containers" ]; then
        print_status "No workspace containers"
        return 0
    fi
    mkdir -p "$dir"

    # Project names for finding a workspace (best effort: needs the API server)
    local server=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
        --filter label=com.docker.compose.service=server | head -1)
    if [ -n "$server" ]; then
        docker exec "$server" node -e '
            const p = require("/app/workspaces/projects.json");
            for (const [id, x] of Object.entries(p)) console.log(`${id}\t${x.projectName || ""}`);
        ' > "$dir/index.tsv" 2>/dev/null || rm -f "$dir/index.tsv"
    fi

    for container in $containers; do
        local id=${container#workspace-}
        if backup_workspace "$container" "$dir/$id"; then
            print_success "Workspace $id ($(du -sh "$dir/$id" | cut -f1))"
        else
            rm -rf "${dir:?}/$id"
            echo "$id" >> "$dir/FAILED"
            WORKSPACES_FAILED=$((WORKSPACES_FAILED + 1))
            print_error "Workspace $id could not be backed up"
        fi
    done
}

write_manifest() {
    local dir="$1"
    {
        echo "XaresAICoder backup"
        echo "created: $(date '+%Y-%m-%d %H:%M:%S %z')"
        echo "host: $(hostname)"
        echo "compose project: $PROJECT"
        echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
        echo
        echo "files:"
        (cd "$dir" && find . -type f ! -name MANIFEST -exec du -h {} + | sort -k2)
    } > "$dir/MANIFEST"
}

# Writes a backup to $1 (built in $1.partial, renamed when complete)
create_backup() {
    local target="$1" with_workspaces="$2" v
    WORK_DIR="$target.partial"
    mkdir -p "$WORK_DIR/volumes"

    if [ -f .env ]; then
        cp .env "$WORK_DIR/env"
        print_success ".env"
    else
        print_warning "No .env found"
    fi
    # Proxy CA: every workspace image trusts it
    if ls squid/certs/*.pem >/dev/null 2>&1; then
        tar -czf "$WORK_DIR/certs.tgz" -C squid certs
        print_success "Proxy CA (squid/certs)"
    fi

    for v in $VOLUMES; do
        local volume="${PROJECT}_$v"
        if ! docker volume inspect "$volume" >/dev/null 2>&1; then
            print_status "Volume $volume does not exist, skipped"
            continue
        fi
        # SQLite and the Git repositories are only consistent while Forgejo is down
        if [ "$v" = forgejo_data ] && container_running "$FORGEJO_CONTAINER"; then
            print_status "Stopping Forgejo for a consistent copy..."
            docker stop "$FORGEJO_CONTAINER" >/dev/null
            FORGEJO_STOPPED=true
        fi
        backup_volume "$volume" "$WORK_DIR/volumes/$v.tgz"
        start_forgejo_again
        print_success "Volume $v ($(du -sh "$WORK_DIR/volumes/$v.tgz" | cut -f1))"
    done

    if [ "$with_workspaces" = true ]; then
        backup_workspaces "$WORK_DIR"
    fi

    write_manifest "$WORK_DIR"
    mv "$WORK_DIR" "$target"
    WORK_DIR=""
}

# Deletes all but the newest $1 regular backups (not the *-before-restore ones)
prune_backups() {
    local keep="$1" old count=0
    [ "$keep" -gt 0 ] || return 0
    while read -r old; do
        [[ $(basename "$old") =~ ^xares-[0-9]{8}-[0-9]{6}$ ]] || continue
        count=$((count + 1))
        [ "$count" -gt "$keep" ] || continue
        rm -rf "$old"
        print_status "Removed old backup $(basename "$old")"
    done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'xares-*' | sort -r)
}

do_backup() {
    local with_workspaces="$1" keep="$2"
    if [ ! -f .env ]; then
        print_error "No .env found in $SCRIPT_DIR - is XaresAICoder deployed here?"
        exit 1
    fi
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_DIR"
    local target="$BACKUP_DIR/xares-$(date +%Y%m%d-%H%M%S)"
    print_status "Creating backup $target"

    create_backup "$target" "$with_workspaces"
    prune_backups "$keep"

    if [ "$WORKSPACES_FAILED" -gt 0 ]; then
        print_error "Backup written to $target, but $WORKSPACES_FAILED workspace(s) are missing (see workspaces/FAILED)"
        exit 1
    fi
    print_success "Backup complete: $target ($(du -sh "$target" | cut -f1))"
}

check_backup() {
    if [ ! -f "$1/MANIFEST" ]; then
        print_error "$1 is not a complete backup (no MANIFEST)"
        exit 1
    fi
}

# Starts the platform containers again, nginx last (it needs the API server
# and Forgejo to resolve)
start_containers() {
    local id nginx=""
    for id in "$@"; do
        if [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")" = nginx ]; then
            nginx="$id"
        else
            docker start "$id" >/dev/null
        fi
    done
    [ -z "$nginx" ] || docker start "$nginx" >/dev/null
}

ca_checksum() {
    [ ! -f squid/certs/squid-ca-cert.pem ] || cksum < squid/certs/squid-ca-cert.pem
}

do_restore() {
    local source="$1" v
    check_backup "$source"
    echo
    print_warning "Restoring the backup from $(sed -n 's/^created: //p' "$source/MANIFEST")"
    echo "  Replaces .env, squid/certs and the volumes:"
    for v in $VOLUMES; do
        [ -f "$source/volumes/$v.tgz" ] && echo "    ${PROJECT}_$v"
    done
    echo "  The platform is stopped meanwhile; workspaces keep running."
    echo "  The current state is saved to $BACKUP_DIR/xares-<time>-before-restore first."
    echo
    if ! confirm "Continue?"; then
        print_status "Restore cancelled"
        exit 1
    fi

    local running=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")
    if [ -n "$running" ]; then
        print_status "Stopping the platform..."
        docker stop $running >/dev/null
    fi

    if [ -f .env ]; then
        mkdir -p "$BACKUP_DIR"
        chmod 700 "$BACKUP_DIR"
        print_status "Saving the current state..."
        create_backup "$BACKUP_DIR/xares-$(date +%Y%m%d-%H%M%S)-before-restore" false
    fi

    local env_changed=false ca_before ca_after
    if [ -f "$source/env" ]; then
        cmp -s "$source/env" .env 2>/dev/null || env_changed=true
        cp "$source/env" .env
        print_success ".env restored"
    fi
    ca_before=$(ca_checksum)
    if [ -f "$source/certs.tgz" ]; then
        tar -xzf "$source/certs.tgz" -C squid
        print_success "Proxy CA restored"
    fi
    ca_after=$(ca_checksum)

    for v in $VOLUMES; do
        [ -f "$source/volumes/$v.tgz" ] || continue
        restore_volume "${PROJECT}_$v" "$source/volumes/$v.tgz" "$v"
        print_success "Volume $v restored"
    done

    echo
    if [ -z "$running" ]; then
        print_status "Start the platform with ./deploy.sh"
    elif [ "$env_changed" = true ] || [ "$ca_before" != "$ca_after" ]; then
        print_warning ".env or the proxy CA differ from before: start with ./deploy.sh so the containers pick them up"
    else
        print_status "Starting the platform again..."
        start_containers $running
    fi
    if [ "$ca_before" != "$ca_after" ]; then
        print_warning "The proxy CA changed: rebuild the code-server image (./deploy.sh without --skip-build); existing workspaces trust the old CA until they are recreated"
    fi
    print_success "Restore complete"
}

do_restore_workspace() {
    local source="$1" id="$2" target="$3"
    check_backup "$source"
    local data="$source/workspaces/$id"
    if [ ! -f "$data/workspace.tgz" ] || [ ! -f "$data/home.tgz" ]; then
        print_error "The backup has no files for workspace $id"
        exit 1
    fi
    local container="workspace-$target"
    if ! docker inspect "$container" >/dev/null 2>&1; then
        print_error "Container $container does not exist. Create a new workspace in the dashboard and use --into <its id>"
        exit 1
    fi

    echo
    print_warning "Copying /workspace and /home/coder of $id (backup from $(sed -n 's/^created: //p' "$source/MANIFEST")) into $container"
    echo "  Files with the same name are overwritten, other files stay."
    [ "$id" = "$target" ] || echo "  Git remotes still point to the repository of the old workspace."
    echo
    if ! confirm "Continue?"; then
        print_status "Restore cancelled"
        exit 1
    fi

    local was_running=false
    if container_running "$container"; then
        was_running=true
        docker stop "$container" >/dev/null
    fi
    local failed=false
    gunzip -c "$data/workspace.tgz" | docker cp -a - "$container:/" &&
        gunzip -c "$data/home.tgz" | docker cp -a - "$container:/home" || failed=true
    [ "$was_running" = false ] || docker start "$container" >/dev/null
    if [ "$failed" = true ]; then
        print_error "Copying the files into $container failed"
        exit 1
    fi
    print_success "Workspace files restored into $container"
}

# Absolute path for an argument given relative to the caller's directory
absolute_path() {
    case "$1" in
        /*) echo "$1" ;;
        *) echo "$PWD/$1" ;;
    esac
}

need_value() {
    if [ -z "$2" ]; then
        print_error "$1 needs a value"
        show_usage
        exit 1
    fi
}

main() {
    local mode=backup with_workspaces=false keep=7 source="" project_id="" into=""
    BACKUP_DIR="$SCRIPT_DIR/backups"

    while [ $# -gt 0 ]; do
        case $1 in
            --dir)
                need_value "$1" "$2"
                BACKUP_DIR=$(absolute_path "$2")
                shift 2
                ;;
            --keep)
                need_value "$1" "$2"
                keep="$2"
                shift 2
                ;;
            --workspaces)
                with_workspaces=true
                shift
                ;;
            --restore)
                need_value "$1" "$2"
                mode=restore
                source=$(absolute_path "$2")
                shift 2
                ;;
            --restore-workspace)
                need_value "$1" "$2"
                need_value "$1 $2" "$3"
                mode=restore-workspace
                source=$(absolute_path "$2")
                project_id="$3"
                shift 3
                ;;
            --into)
                need_value "$1" "$2"
                into="$2"
                shift 2
                ;;
            --yes)
                ASSUME_YES=true
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    if ! [[ $keep =~ ^[0-9]+$ ]]; then
        print_error "--keep needs a number"
        exit 1
    fi
    for id in "$project_id" "$into"; do
        if ! [[ $id =~ ^[A-Za-z0-9-]*$ ]]; then
            print_error "Invalid project id: $id"
            exit 1
        fi
    done

    cd "$SCRIPT_DIR"
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker is not reachable"
        exit 1
    fi

    # Compose prefixes volume names with the project name: COMPOSE_PROJECT_NAME,
    # else the directory name in lower case
    PROJECT=${COMPOSE_PROJECT_NAME:-$(env_value COMPOSE_PROJECT_NAME)}
    PROJECT=${PROJECT:-$(basename "$SCRIPT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')}
    # tar runs in the pinned nginx image (busybox), which every installation has
    HELPER_IMAGE=$(sed -n 's/^ *image: *\(nginx:[^ ]*\) *$/\1/p' docker-compose.yml | head -1)
    HELPER_IMAGE=${HELPER_IMAGE:-nginx:alpine}

    trap cleanup EXIT
    trap 'exit 130' INT TERM

    case $mode in
        backup) do_backup "$with_workspaces" "$keep" ;;
        restore) do_restore "$source" ;;
        restore-workspace) do_restore_workspace "$source" "$project_id" "${into:-$project_id}" ;;
    esac
}

main "$@"
