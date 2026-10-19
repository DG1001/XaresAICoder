#!/bin/sh
# Points the whitelist ACL at the Security Proxy workspace subnet
# (SECURITY_NETWORK_SUBNET from docker-compose) before squid starts, so the
# subnet is configured in .env instead of being baked into squid.conf.
set -e
if [ -n "$SECURITY_NETWORK_SUBNET" ]; then
    case "$SECURITY_NETWORK_SUBNET" in
        *[!0-9a-fA-F.:/]*)
            echo "Invalid SECURITY_NETWORK_SUBNET: $SECURITY_NETWORK_SUBNET" >&2
            exit 1 ;;
    esac
    sed -i "s|^acl internal_network src .*|acl internal_network src $SECURITY_NETWORK_SUBNET|" /etc/squid/squid.conf
fi
# The applied whitelist is kept on a volume; start with the default
mkdir -p /etc/squid/whitelist
if [ ! -s /etc/squid/whitelist/whitelist.conf ]; then
    cp /etc/squid/whitelist-default.conf /etc/squid/whitelist/whitelist.conf
fi
exec entrypoint.sh "$@"
