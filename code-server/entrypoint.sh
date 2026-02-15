#!/bin/bash
echo "Starting XaresAICoder code-server..."

# Update CA certificates if squid proxy cert is present (for HTTPS interception proxy support)
# Runs as root via sudo since the entrypoint executes as the coder user
if [ -f /usr/local/share/ca-certificates/squid-ca.crt ] && grep -q "BEGIN CERTIFICATE" /usr/local/share/ca-certificates/squid-ca.crt 2>/dev/null; then
    sudo update-ca-certificates --fresh > /dev/null 2>&1
fi

# Check and install missing extensions
/usr/local/bin/check-extensions.sh

# Check for auth override (written by password management feature)
if [ -f /home/coder/.code-server-auth ]; then
    . /home/coder/.code-server-auth
    # AUTH_FLAG is "password" or "none", PASSWORD env var is set/unset by the sourced file
    # Replace --auth value in CMD args
    NEWARGS=()
    SKIP=false
    for arg in "$@"; do
        if $SKIP; then
            SKIP=false
            continue
        fi
        if [ "$arg" = "--auth" ]; then
            NEWARGS+=("--auth" "$AUTH_FLAG")
            SKIP=true
        else
            NEWARGS+=("$arg")
        fi
    done
    exec "${NEWARGS[@]}"
fi

exec "$@"
